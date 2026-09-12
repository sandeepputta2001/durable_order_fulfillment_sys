# SDLC - Software Development Lifecycle

This document maps the standard SDLC stages onto exactly what exists in
this repository. It is the "process" view; `SOFTWARE_FACTORY.md` is the
"automation/platform" view of the same work - see that document's closing
section for how the two relate.

## 1. Requirement

**Requirement:** Customers need to place orders that go through a
multi-step fulfillment process (validation, inventory, payment,
confirmation, notification) that must survive crashes, retries, and
transient failures without losing or duplicating work, and without the
team hand-building a state machine to track it.

## 2. Planning

**Planning:** Scope was fixed deliberately small (see "Important
architectural constraints" - no Kubernetes, Kafka, Redis, microservices,
API gateway, or cloud provider) so the POC demonstrates the *pattern*
(Temporal-orchestrated durable workflow + boring REST API + plain SQL)
without infrastructure unrelated to that pattern. Two runnable units were
planned: an API process and a Worker process, independently deployable.

## 3. Architecture / Design

**Design:** Documented in `ARCHITECTURE.md`. Key decisions: Temporal owns
orchestration and durability; Postgres is the system of record for
business data (orders/inventory/payments), not Workflow state; each
fulfillment step is a Temporal Activity, never inline Workflow code;
idempotency is handled at two layers (Workflow ID reuse policy for
duplicate requests, a unique `payments.order_id` for duplicate Activity
executions).

## 4. Development

**Development:** TypeScript (strict mode) throughout. Fastify for the API,
plain `pg` (no ORM) for the database layer with hand-written SQL
migrations, and the Temporal TypeScript SDK for the Workflow/Activities/
Worker. Structured JSON logging (`pino`) and Prometheus metrics
(`prom-client`) were built in from the start rather than bolted on later.

## 5. Testing

**Testing:** Vitest across four layers, all passing before any Docker or
CI work began:
- **API** (`tests/api/`): create/get/invalid/not-found, plus idempotent
  duplicate-order-id behavior, against a real Postgres with the Temporal
  client module mocked (no Temporal server required for these).
- **Database** (`tests/db/`): the order-creation transaction and inventory
  reservation's locking/rollback behavior, against a real Postgres.
- **Activities** (`tests/activities/`): payment success, payment transient
  failure under `PAYMENT_FAILURE_MODE`, payment idempotency, and
  insufficient-inventory business failure - against a real Postgres.
- **Workflow** (`tests/workflows/`): the happy path, a non-retryable
  business failure, and a transient failure that retries then succeeds -
  using Temporal's own `TestWorkflowEnvironment` (a real, ephemeral,
  time-skipping Temporal server) with mocked Activities, so the Workflow's
  orchestration logic is verified independently of the database.

## 6. Build

**Build:** `npm run build` compiles TypeScript to `dist/` via `tsc`
(strict mode - the build fails on type errors) and copies the SQL
migration files alongside the compiled Worker/API code. A multi-stage
`Dockerfile` then produces a production image containing only compiled
JavaScript and production dependencies - no TypeScript source, compiler,
or dev dependencies ship in the final image.

## 7. Deployment

**Deployment:** `docker compose up --build` (or `make up`) starts the
entire stack - Postgres, Temporal, Temporal UI, API, Worker - as one
command, for both local development and the exe.dev VM. `scripts/deploy.sh`
wraps this into an idempotent, repeatable deployment: pull, build, start,
health-check, report status. A `deploy` job in `.github/workflows/ci.yml`
runs this same script over SSH automatically on every push to `main` (once
`build-and-test` and `docker-build` pass), so deployment to exe.dev is
continuous, not a manual step someone has to remember. See README
"Deployment to exe.dev" and "Continuous Deployment via GitHub Actions".

## 8. Operations

**Operations:** `GET /health` (liveness) and `GET /ready` (readiness,
checks Postgres and Temporal connectivity) let an operator or orchestrator
tell whether an instance should receive traffic. The Worker and API are
independently restartable; migrations are applied automatically and
idempotently on startup, so a redeploy never requires a manual DB step.

## 9. Monitoring

**Monitoring:** Structured logs with consistent fields (`orderId`,
`workflowId`, `activity`, `status`, `durationMs`, `error`) on every
significant operation; Prometheus metrics for HTTP traffic/latency and
order/Activity outcomes at `GET /metrics` (API) and `:9464/metrics`
(Worker); the Temporal UI for per-Workflow-Execution visibility. See
`ARCHITECTURE.md`'s Observability table for what each signal is for.

## 10. Feedback

**Feedback:** The failure-simulation mechanism
(`PAYMENT_FAILURE_MODE`, documented end-to-end in
`FAILURE_SCENARIOS.md`) is the feedback loop made concrete: it lets anyone
running this POC directly observe Temporal retrying a failing Activity,
watch the retries in the Temporal UI and in metrics, fix the underlying
problem (flip the flag back), and watch the *same* Workflow Execution
recover and complete - without writing a single line of recovery code.
That observed behavior is the core evidence this POC exists to produce.
