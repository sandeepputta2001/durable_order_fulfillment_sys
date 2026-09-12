# Durable Order Fulfillment System

A complete, runnable Proof of Concept demonstrating how a modern backend
system is built and *operated*: TypeScript + Fastify + PostgreSQL for the
application, the Temporal TypeScript SDK for durable workflow
orchestration, Docker/Docker Compose for packaging, GitHub Actions for
CI/CD, exe.dev for a production-like runtime, and structured logging +
Prometheus metrics + the Temporal UI for observability.

The business problem is small on purpose (place an order, run it through
validate -> reserve inventory -> pay -> confirm -> notify) so the whole
"software factory" around it - source control, CI, testing, Docker,
deployment, observability, failure recovery - stays visible instead of
getting lost in business complexity. See `docs/ARCHITECTURE.md`, `docs/SDLC.md`, and
`docs/SOFTWARE_FACTORY.md` for how each stage of that factory maps onto this
repository.

## Project overview

```text
Client -> Fastify API -> starts a Temporal Workflow (Workflow ID = orderId)
                              |
                              v
                    Temporal Server (durable Event History)
                              |
                              v
                    Order Worker executes 5 Activities:
                    validateOrder -> reserveInventory -> processPayment
                                   -> confirmOrder -> sendNotification
```

Every Activity is a real (simulated) side effect against PostgreSQL. The
Workflow itself contains **no I/O** - see `src/workflows/order.workflow.ts`
for why that matters.

## Architecture

Full diagrams and component-by-component rationale live in
`docs/ARCHITECTURE.md`. Summary:

| Component | Role |
|---|---|
| Fastify API | HTTP boundary; validates input, starts Workflows, reads order state |
| Temporal Server | Persists Workflow state (Event History), dispatches tasks |
| Order Worker | Runs the Workflow + Activities; the only place I/O happens |
| PostgreSQL | System of record for orders/items/inventory/payments |
| Temporal UI | Inspect Workflow Executions, retries, failures |
| Docker Compose | Runs the whole stack identically everywhere |

## Prerequisites

- Node.js 20+ and npm
- Docker and Docker Compose v2 (`docker compose`, not `docker-compose`)
- `curl` (for the demo commands below)

## Local setup

```bash
git clone <this-repo>
cd durable-order-system
make setup    # npm install, creates .env, starts postgres+temporal+temporal-ui, runs migrations
```

`make setup` starts only the infrastructure (Postgres, Temporal, Temporal
UI) in Docker so you can run the API and Worker directly on the host with
fast reload - see "Running locally" below. To run *everything* in Docker
instead (no local Node process at all), skip straight to "Docker setup".

## Running locally

```bash
make dev
```

This runs both the API (`http://localhost:8080` when run this way - note:
this differs from the Docker Compose port, see "Ports" below) and the
Worker with hot reload via `tsx watch`, in one terminal (using
`concurrently`). Stop with Ctrl-C.

Or run them in separate terminals:

```bash
npm run dev:api
npm run dev:worker
```

## Running tests

```bash
make test
# or: npm test
```

Requires Postgres reachable at `DATABASE_URL` (defaults to
`localhost:5433`, matching `make setup`'s Postgres). The suite covers four
layers - API, database, Activities, and Workflow (using Temporal's own
ephemeral `TestWorkflowEnvironment`, so no separate Temporal server is
needed to run these tests):

```bash
npx vitest run tests/api          # POST/GET /orders, invalid input, 404, idempotency
npx vitest run tests/db           # order creation transaction, inventory locking/rollback
npx vitest run tests/activities   # payment success/transient-failure/idempotency, insufficient inventory
npx vitest run tests/workflows    # happy path, business failure, transient-retry-then-succeed
```

Other quality checks:

```bash
make lint        # eslint .
make typecheck    # tsc --noEmit (strict mode)
npm run format:check
```

## Docker setup

```bash
make up
# or: docker compose up --build -d
```

Starts everything: Postgres, Temporal, Temporal UI, API, Worker.

### Ports

| Service | Container port | Host port | Notes |
|---|---|---|---|
| API | 8080 | **8085** | Shifted from 8080 to avoid clashing with something already using host 8080 on many dev machines |
| Temporal (gRPC frontend) | 7233 | 7233 | |
| Temporal UI | 8080 | 8081 | Shifted so it doesn't collide with the API |
| PostgreSQL | 5432 | **5433** | Shifted to avoid clashing with a Postgres already running on the host |
| Worker metrics | 9464 | 9464 | Separate process from the API - see "Observability" |

If none of those host ports are free on your machine either, edit the
`ports:` mappings in `docker-compose.yml` (only the left-hand/host side -
the container-internal ports and inter-service networking are unaffected).

```bash
make logs   # docker compose logs -f
make down   # docker compose down
```

## Temporal UI

Open `http://localhost:8081`. Every order you create shows up as a
Workflow Execution named `order-<id>` (or your own custom order ID - see
"Idempotency" below). Click into one to see its full Event History: every
Activity scheduled, every attempt, every retry with backoff, every
input/output payload.

## API examples

```bash
# Create an order
curl -X POST http://localhost:8085/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "customer-123",
    "items": [
      { "productId": "product-1", "quantity": 2 }
    ]
  }'
# -> { "orderId": "order-<uuid>", "status": "PENDING" }

# Check its status (poll until CONFIRMED)
curl http://localhost:8085/orders/<ORDER_ID>
# -> { "id": "...", "customerId": "customer-123", "status": "CONFIRMED", "items": [...] }

# Health / readiness
curl http://localhost:8085/health
curl http://localhost:8085/ready

# Prometheus metrics
curl http://localhost:8085/metrics        # HTTP + orders-created metrics (API process)
curl http://localhost:9464/metrics        # order outcome + Activity metrics (Worker process)
```

### `/health` vs `/ready`

- **`GET /health`** (liveness): "is this process alive at all?" Always
  returns `200 { "status": "ok" }` with no dependency checks. An
  orchestrator uses this to decide whether to **restart** a container -
  a slow database must never cause a healthy process to be killed.
- **`GET /ready`** (readiness): "can this instance actually serve traffic
  right now?" Checks Postgres connectivity and that the Temporal client
  connected at startup; returns `503` if either is unavailable. An
  orchestrator uses this to decide whether to **route traffic** to this
  instance.

## Idempotency

Two independent layers, because they protect against two different
things:

1. **Duplicate `POST /orders` requests.** Pass your own `orderId` in the
   request body to make retries idempotent:

   ```bash
   curl -X POST http://localhost:8085/orders \
     -H "Content-Type: application/json" \
     -d '{"orderId": "order-demo-1", "customerId": "customer-123", "items": [{"productId": "product-1", "quantity": 1}]}'
   # repeat the exact same request -> 200 (not 201), same order, no second Workflow started
   ```

   Under the hood: `client.workflow.start(..., { workflowId: orderId,
   workflowIdReusePolicy: 'REJECT_DUPLICATE' })` - Temporal itself refuses
   to start a second Workflow Execution for an ID that has ever been used,
   whether the first is still running or already finished. The API catches
   `WorkflowExecutionAlreadyStartedError` and returns the existing order's
   current state instead of erroring. If you omit `orderId`, one is
   generated per request - fine for a "new order" request, but it means
   nothing correlates that request with any future retry of it.

2. **A Temporal Activity retried by Temporal itself** (at-least-once
   execution - e.g. `processPayment` times out right after charging but
   before Temporal records success, so Temporal schedules it again). This
   is handled *inside* the Activity, not by the Workflow ID: `payments`
   has a `UNIQUE` constraint on `order_id`, and `processPayment` checks for
   an existing payment row before "charging" again. See
   `src/activities/process-payment.ts`.

**Why this matters:** in a distributed system, "the request was retried"
and "the operation ran more than once" are different facts, and you
cannot prevent the second without designing for it explicitly - a network
timeout tells you nothing about whether the operation you were waiting on
actually completed. At-least-once execution (Temporal's guarantee for
Activities) trades "might run twice" for "will never silently be lost";
idempotent Activities are what make that trade safe.

## Failure simulation (the main demo)

See `docs/FAILURE_SCENARIOS.md` for all five scenarios with exact commands.
The headline one:

```bash
make demo-fail    # sets PAYMENT_FAILURE_MODE=true, recreates the worker
# create an order, watch it fail and retry in the Temporal UI
make demo-fix     # sets PAYMENT_FAILURE_MODE=false, recreates the worker
# the next retry attempt succeeds; the SAME Workflow Execution completes
```

No code anywhere in this repository implements the retry loop you'll see
in the Temporal UI - it is entirely Temporal's configured Activity retry
policy (`src/workflows/order.workflow.ts`).

## 5-Minute Demo

```text
1. make up                                  # start everything
2. open http://localhost:8081               # Temporal UI
3. curl -X POST .../orders (product-1)      # create an order
4. watch the Workflow Execution in the UI - see each Activity run in order
5. make demo-fail                           # enable payment failure mode
6. curl -X POST .../orders (product-1)      # create a second order
7. watch processPayment fail + retry with backoff in the UI
8. make demo-fix                            # disable payment failure mode
9. watch the next retry attempt succeed in the UI
10. curl .../orders/<second order id>        # status: CONFIRMED
```

Bonus, in the same session: create an order for `product-oos` (seeded
with zero stock) to see a business failure (`FAILED`, no retries at all) -
contrast this with the payment scenario, which retries.

## Temporal concepts, as used in this POC

| Concept | What/why | Here |
|---|---|---|
| **Workflow** | Deterministic orchestration code; Temporal replays it to resume execution | `orderFulfillmentWorkflow` |
| **Activity** | Non-deterministic work (I/O); where retries/timeouts apply | `validateOrder`, `reserveInventory`, `processPayment`, `confirmOrder`, `sendNotification` |
| **Worker** | Process that executes Workflow + Activity code, polling a Task Queue | `src/workers/order.worker.ts` |
| **Task Queue** | Named channel a Worker polls; decouples "what to run" from "which process runs it" | `order-fulfillment` |
| **Workflow ID** | Stable identifier Temporal uses to dedupe Executions | the order's `orderId` |
| **Determinism** | Same history in -> same decisions out, so replay is safe | enforced by keeping all I/O in Activities |
| **Durability** | State survives process/Worker crashes because it's in Temporal's Event History, not memory | demonstrated in docs/FAILURE_SCENARIOS.md Scenario 1 |
| **Activity retry** | Automatic re-execution with backoff on transient failure | `paymentActivityOptions`/`standardActivityOptions` |
| **Activity timeout** | Bounds how long a single attempt may run | `startToCloseTimeout: '10 seconds'` |
| **Idempotency** | Safe to execute more than once | Workflow ID reuse policy + unique `payments.order_id` |
| **Failure recovery** | Resuming correctly after a crash/failure, without app-level state machines | Scenario 1-3 in docs/FAILURE_SCENARIOS.md |

For each, "what would we need without Temporal?" is answered in
`docs/ARCHITECTURE.md`'s "Without Temporal" section.

## exe.dev concepts

| Concept | Role in this POC |
|---|---|
| VM | The persistent Linux host running Docker Compose |
| SSH | How you reach the VM to run `scripts/deploy.sh` |
| Persistent environment | Unlike ephemeral CI runners, state (Postgres data, Temporal's Event History) survives between deploys |
| HTTPS proxy | Terminates TLS and forwards to the API container - see "Deployment to exe.dev" |
| Port exposure | Only the API port should be exposed publicly - see "Security" |
| Private vs public access | Postgres/Temporal/Temporal UI stay VM-internal; only the API is (optionally) public |
| Docker inside the VM | Same `docker-compose.yml` as local dev, no exe.dev-specific config needed |

## Deployment to exe.dev

1. **Create an exe.dev VM.** Any size with Docker support is sufficient
   for this POC's footprint (Postgres + Temporal + Temporal UI + API +
   Worker).
2. **SSH into the VM.**
   ```bash
   ssh <you>@<your-exe.dev-host>
   ```
3. **Install/verify Docker.**
   ```bash
   docker --version && docker compose version
   ```
4. **Clone the repository.**
   ```bash
   git clone <this-repo> durable-order-system
   cd durable-order-system
   ```
5. **Configure the environment.**
   ```bash
   cp .env.example .env
   # edit .env if you need non-default ports or settings
   ```
6. **Start Docker Compose.**
   ```bash
   ./scripts/deploy.sh
   ```
   (This builds images, starts the stack, and waits for `/ready` - see
   "Deployment script" below. Equivalent to `make up` for a first deploy.)
7. **Verify health.**
   ```bash
   curl http://localhost:8085/health
   curl http://localhost:8085/ready
   ```
8. **Expose the API through exe.dev's HTTPS proxy.** Follow exe.dev's own
   port-exposure workflow for the VM to map the API's port (8085 in this
   Compose file) to a public HTTPS URL. **Do not** expose Postgres (5433),
   Temporal (7233), or the Temporal UI (8081) publicly - see "Security"
   below for why.
9. **Access the API remotely** via the HTTPS URL exe.dev gives you for
   that port mapping, e.g.:
   ```bash
   curl -X POST https://<your-exe.dev-url>/orders \
     -H "Content-Type: application/json" \
     -d '{"customerId": "customer-123", "items": [{"productId": "product-1", "quantity": 1}]}'
   ```

### Continuous Deployment via GitHub Actions

Steps 1-5 above are one-time manual setup. After that, `.github/workflows/
ci.yml` has a third job, `deploy`, that runs automatically after
`build-and-test` and `docker-build` both pass on a push to `main` (never
on a pull request, so a PR from a fork cannot trigger it) - it SSHes into
the exe.dev VM and re-runs `scripts/deploy.sh` there, exactly as if you'd
run it by hand in step 6. From that point on, merging to `main` is what
deploys - see `docs/SOFTWARE_FACTORY.md` for how this fits the overall
CI/CD pipeline.

To enable it, add these as repository secrets (**Settings -> Secrets and
variables -> Actions**), and create a GitHub **Environment** named
`exe-dev` (**Settings -> Environments**) - using an Environment (rather
than plain repository secrets) lets you optionally require manual
approval before a deploy runs, which is worth turning on for a real VM:

| Secret | Value |
|---|---|
| `EXE_DEV_HOST` | The exe.dev VM's hostname or IP |
| `EXE_DEV_USER` | The SSH user to deploy as |
| `EXE_DEV_SSH_KEY` | A private key (PEM) whose matching public key is in that user's `~/.ssh/authorized_keys` on the VM - generate a dedicated deploy key, don't reuse your personal one |
| `EXE_DEV_DEPLOY_PATH` | Absolute path to the git checkout on the VM (e.g. `/home/deploy/durable-order-system`, the directory from step 4) |
| `EXE_DEV_PORT` | Optional; SSH port, defaults to `22` |

The workflow never sees your key material beyond what `appleboy/ssh-
action` needs to open the SSH connection for that one job run.
Because `scripts/deploy.sh` is idempotent (see "Deployment script"
below), a deploy that runs on every merge to `main` is safe even if
nothing meaningful changed.

### Private vs public access

By default, treat everything as VM-internal. Only make the API's port
public through exe.dev's proxy once you intend for it to be reachable from
the internet - the Temporal UI and Postgres have no authentication in this
POC's configuration and must stay private (reachable only over SSH
tunnel/port-forward if you need to inspect them remotely, e.g. `ssh -L
8081:localhost:8081 <you>@<your-exe.dev-host>`).

## Deployment script

`scripts/deploy.sh` is idempotent - safe to run repeatedly, including to
pick up new commits:

```bash
./scripts/deploy.sh
```

It pulls the latest code (if run inside a git checkout), ensures `.env`
exists, runs `docker compose build`, runs `docker compose up -d` (which
only recreates containers whose configuration actually changed), polls
`/ready` until the API responds, and prints `docker compose ps` plus a
final health check.

## Rollback

This POC builds images from source on the deploy target rather than
pulling a pinned tag from a registry (see `docs/SOFTWARE_FACTORY.md`'s
"Artifact creation" section for why, and what a production setup would do
differently). Rollback here therefore means rolling back the **source**,
then redeploying from it:

```bash
git log --oneline                 # find the last known-good commit/tag
git checkout <previous-commit>    # or: git checkout <tag>
./scripts/deploy.sh               # rebuilds and redeploys that version
```

```text
Version N (bad)
   |
   v
git checkout <version N-1>
   |
   v
./scripts/deploy.sh   (rebuilds image from that commit, recreates containers)
   |
   v
Rolled back
```

In a production setup where CI pushes a tagged image to a registry
instead, rollback would be simpler still - just re-point
`docker-compose.yml`'s image tag at the previous version and run `docker
compose up -d` with no rebuild required.

## Security

- **Input validation**: every request body/param is validated against a
  JSON Schema at the API boundary (`src/api/schemas/`) before it reaches
  business logic.
- **No hardcoded secrets**: all configuration is environment-driven (see
  `.env.example`); this POC has no real secrets to manage (payment/
  notification are simulated), but the pattern is what you'd use to inject
  real credentials via a secrets manager in production.
- **Non-root Docker user**: the production image runs as `appuser`, not
  root (see `Dockerfile`).
- **Dependency auditing**: `npm audit` runs in CI; production dependencies
  currently have zero known vulnerabilities (`npm audit --omit=dev`). Two
  dev-only tooling advisories (in `vitest`'s `vite`/`esbuild` dependency
  chain, affecting only Vitest's local dev/UI server) remain open pending
  an upstream major-version bump; they do not affect the built application
  or the production Docker image, which never installs dev dependencies.
- **Minimal public attack surface**: only the API should be exposed
  publicly through exe.dev's HTTPS proxy. PostgreSQL, Temporal's gRPC
  frontend, and the Temporal UI have no authentication configured in this
  POC and must remain VM-internal only (see "Private vs public access").
  The Worker's metrics port (9464) should likewise stay internal - it is
  meant for a Prometheus scraper on the same network, not public access.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `docker compose up` fails with a port-in-use error | Something on your host already uses one of the mapped ports (commonly 5432/8080); edit the host side of the relevant `ports:` mapping in `docker-compose.yml` |
| Worker container exits with `Error loading shared library ld-linux-x86-64.so.2` | You changed the Dockerfile's base image to an Alpine variant - Temporal's native `core-bridge` addon requires glibc; keep `node:20-slim` (Debian-based) |
| API logs `Timed out waiting for Temporal server` | Temporal's `auto-setup` container takes longer than expected to initialize its schema on first boot; give it another minute and check `docker compose logs temporal` |
| `GET /ready` returns `503` | Check `docker compose ps` - if Postgres isn't `healthy` or Temporal isn't reachable, the API correctly reports not-ready rather than serving broken traffic |
| An order is stuck in `PAYMENT_PROCESSING` | Expected if `PAYMENT_FAILURE_MODE=true` - see docs/FAILURE_SCENARIOS.md Scenario 2/3; check the Temporal UI for retry attempts |
| Tests fail with `deadlock detected` | Multiple Vitest test files ran concurrently against the same real Postgres database; `vitest.config.ts` sets `fileParallelism: false` specifically to prevent this - make sure you haven't overridden it |
| `npm run migrate` can't connect | `DATABASE_URL` must point at `localhost:5433` (not 5432) when running outside Docker - see `.env.example`'s comment on the port shift |

## Production improvements beyond this POC

This is a POC; a production rollout would additionally need: a container
registry + immutable image tags (for real rollback, see "Rollback"
above); TLS between internal services, not just at the exe.dev edge;
secrets management (Vault/cloud secrets manager) instead of `.env` files;
authentication/authorization on the API; distributed tracing (OpenTelemetry)
correlating API requests through to Activity execution; Temporal Cloud or
a properly-sized, HA self-hosted Temporal cluster (this POC's single
`auto-setup` container is a dev/POC-only configuration, not
production-grade); database backups/PITR and connection pooling
(PgBouncer) at scale; horizontal scaling of the API and Worker with a load
balancer in front of the API; and alerting rules on top of the Prometheus
metrics this POC already exposes.
