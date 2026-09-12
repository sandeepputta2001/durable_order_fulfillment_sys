# Software Factory

`SDLC.md` describes the *lifecycle* - the sequence of stages a change goes
through. This document describes the *Software Factory* - the automation
and tooling in this repository that makes that lifecycle repeatable,
instead of a checklist a human has to remember to follow every time.

> **SDLC = the process.** **Software Factory = the automation/platform
> that makes the process repeatable.** A team can follow an SDLC by hand
> once; a Software Factory is what lets them follow it correctly a
> thousand times without anyone having to remember all the steps.

## The pipeline, as implemented here

```text
Developer
   |
   | git commit / git push
   v
Git  (source control - this repository)
   |
   | opens a Pull Request
   v
Pull Request  (code review happens here)
   |
   v
CI  (.github/workflows/ci.yml, runs on every push to any branch, and every PR to main)
   |
   +-- lint            (eslint .)
   +-- typecheck        (tsc --noEmit, strict mode)
   +-- test             (vitest run - API, DB, Activity, Workflow tests)
   +-- build            (tsc -> dist/)
   +-- docker build     (multi-stage Dockerfile)
   +-- security scan    (npm audit + Trivy image scan)
   |
   v
Docker image  (built and scanned by CI on every push; in this POC the image
   |           actually deployed is rebuilt from source directly on the
   |           target host by scripts/deploy.sh rather than pushed to a
   |           registry - see "Artifact creation" below for why that's a
   |           reasonable choice here and what a production factory would
   |           do instead)
   v
CD  (`deploy` job in the SAME ci.yml, gated on build-and-test + docker-build
   |   passing, runs only on a push to main - not on PRs - and only if the
   |   exe.dev SSH secrets are configured, see README "Continuous
   |   Deployment via GitHub Actions")
   |
   +-- SSH into the exe.dev VM (appleboy/ssh-action)
   +-- run scripts/deploy.sh on the VM (idempotent pull -> build -> up -> health-check)
   |
   v
exe.dev VM  (production-like runtime, HTTPS proxy in front of Docker Compose)
   |
   v
Monitoring  (logs, Prometheus metrics, Temporal UI)
   |
   v
Feedback  (an operator observes a problem, e.g. via PAYMENT_FAILURE_MODE demo)
   |
   +------------------------------------------------------------> back to SDLC (Requirement/Planning)
```

## Each stage, concretely

### Source control
A single Git repository. Application code, infrastructure (Dockerfile,
docker-compose.yml), CI pipeline, and documentation all live together
(GitOps-adjacent: the desired state of the whole system is one `git
clone` away), so there is never a question of which version of the infra
config matches which version of the code.

### Code review
Enforced by opening a Pull Request rather than pushing straight to `main`
(the CI workflow triggers on both `push` and `pull_request`, so a PR gets
the exact same checks a merge would). This repository does not include a
branch-protection configuration (that lives in GitHub repo settings, not
in code), but the pipeline is designed to be the required check behind
one.

### CI (Continuous Integration) and CD (Continuous Deployment)
`.github/workflows/ci.yml`, three jobs:
1. **build-and-test**: install -> typecheck -> lint -> format check -> test
   (against a real Postgres service container) -> build -> `npm audit`.
2. **docker-build**: builds the production image with Buildx (layer-cached
   across runs) and scans it with Trivy for CRITICAL/HIGH vulnerabilities.
3. **deploy**: runs only after both jobs above succeed, and only on a push
   to `main` (never on a pull request - a fork's PR must not be able to
   trigger a deploy using this repo's secrets). It SSHes into the exe.dev
   VM (via `appleboy/ssh-action`, using the `EXE_DEV_*` repository secrets
   and the `exe-dev` GitHub Environment - see README "Continuous
   Deployment via GitHub Actions") and runs `scripts/deploy.sh` there. This
   is the CD half of CI/CD: merging to `main` is what ships a change.

The pipeline fails the build on any lint, typecheck, test, or `tsc` build
failure - see the CI job for the exact commands. `deploy` only runs once
those checks are green, so a broken build never reaches the VM.

### Testing
Four layers (API, DB, Activities, Workflow - see `SDLC.md` stage 5 and
`README.md`), all running in CI on every push/PR, none requiring manual
steps or a running Temporal server on the CI host (the Workflow tests spin
up Temporal's own ephemeral test server; the API/Activity/DB tests use a
Postgres service container CI provisions automatically).

### Security
- **Input validation** at the API boundary (Fastify JSON Schema) rather
  than trusting client input.
- **Dependency auditing**: `npm audit` in CI.
- **Container scanning**: Trivy scans the built image for known CVEs.
- **No hardcoded secrets**: all configuration is environment-driven (see
  `.env.example`); this POC has no real secrets to manage since the
  payment/notification integrations are simulated, but the pattern is the
  same one you'd use to inject a real API key via a secrets manager.
- **Non-root container user**: the production Docker image runs as an
  unprivileged `appuser`, not root.
- **Minimal attack surface**: only the API port is meant to be exposed
  publicly (see README "Security").

### Artifact creation
The build produces a versioned artifact: a Docker image built via a
multi-stage `Dockerfile` (compile stage discarded, only compiled JS +
production `node_modules` ship). CI builds and scans this image on every
push to prove it builds cleanly, but does **not** push it to a registry in
this POC - `scripts/deploy.sh` instead builds the image directly on the
target host from the pulled source. That is a deliberate simplification
consistent with "don't over-engineer this POC" (no registry, no
credentials to manage for pushing/pulling images); a production Software
Factory would instead have CI push a tagged image to a registry (e.g.
GHCR) and have deployment pull that exact tag, which is what makes
rollback-by-tag (see `FAILURE_SCENARIOS.md`/README "Rollback") trivial
instead of requiring a rebuild.

### Docker
`Dockerfile` (multi-stage build) and `docker-compose.yml` (the full local/
exe.dev stack: Postgres, Temporal, Temporal UI, API, Worker) are the unit
of deployment - the same Compose file runs on a developer's laptop and on
the exe.dev VM, with only environment variables differing between them.

### Deployment
`scripts/deploy.sh` is the one command that takes a Git checkout on a
host to a running, health-checked stack: pull latest code, build images,
`docker compose up -d`, poll `/ready` until it succeeds, print status. It
is idempotent - safe to run repeatedly, e.g. to pick up a new commit,
because `docker compose up -d` only recreates containers whose config
actually changed. It is invoked two ways: manually over SSH (first-time
setup, or whenever you want to trigger it by hand), and automatically by
the `deploy` CI job on every push to `main` - both paths run the exact
same script, so there is only one deployment procedure to reason about,
not a separate "manual steps" doc that quietly drifts from what CI does.

### Environment configuration
Every environment-specific value (ports, database URL, Temporal address,
the failure-simulation flag) comes from environment variables, loaded from
`.env` locally or injected by Docker Compose/exe.dev - see
`src/config/config.ts` and `.env.example`. The same compiled artifact runs
unmodified across local dev, CI, and exe.dev.

### Observability
See `ARCHITECTURE.md`'s Observability table: structured logs, Prometheus
metrics, and the Temporal UI together answer "what happened," "how much/
how often," and "what happened to this specific order," respectively.

### Rollback
See README "Rollback". Because deployment here rebuilds from source
rather than pulling a pinned image tag, rollback in this POC means
checking out a previous Git commit/tag and re-running
`scripts/deploy.sh` - documented explicitly so it's clear what a real
registry-based rollback (`docker compose up -d` after just changing an
image tag, no rebuild) would remove.

## Why this matters

None of these stages is exotic - every team ends up needing source
control, some form of review, automated checks, a repeatable build, a way
to deploy, and a way to know if it's working. The "Software Factory"
framing is just the recognition that when those steps are automated and
wired together (as they are here), a change goes from a developer's laptop
to a running, observable system on exe.dev through one repeatable path -
not through the fallible, ad hoc set of manual steps a human would
otherwise have to remember correctly every single time.
