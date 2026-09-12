# Architecture

## System diagram

```text
                                   Internet
                                      |
                                      | HTTPS
                                      v
                              exe.dev HTTPS Proxy
                                      |
                                      v
                               exe.dev VM (Docker)
  +----------------------------------------------------------------------+
  |                                                                      |
  |   +-------------+        +-------------------+       +-----------+  |
  |   |  Fastify    |------->|  Temporal Server   |<----->| Temporal  |  |
  |   |  API        |  gRPC  |  (auto-setup)      |  gRPC |  UI       |  |
  |   |  :8080      |        |  :7233             |       |  :8080    |  |
  |   +------+------+        +---------+---------+       +-----------+  |
  |          |                         |                                |
  |          | SQL                     | schedules Activities           |
  |          v                         v                                |
  |   +-------------+          +-------------------+                    |
  |   | PostgreSQL  |<---------|  Order Worker      |                    |
  |   | :5432       |   SQL    |  (Activities)      |                    |
  |   +-------------+          |  :9464 /metrics    |                    |
  |                             +-------------------+                    |
  +----------------------------------------------------------------------+
```

Request flow for creating an order:

```text
Client
  |  POST /orders
  v
Fastify API  --INSERT order + items (transaction)-->  PostgreSQL
  |
  |  client.workflow.start(orderFulfillmentWorkflow, { workflowId: orderId })
  v
Temporal Server  --records WorkflowExecutionStarted event-->  Event History (persisted)
  |
  |  dispatches Activity tasks on "order-fulfillment" Task Queue
  v
Order Worker  --executes--> validateOrder -> reserveInventory -> processPayment -> confirmOrder -> sendNotification
                                   |                  |                |
                                   v                  v                v
                              PostgreSQL         PostgreSQL       PostgreSQL
```

## Components, and why each exists

### Fastify API
The only externally-facing component. Accepts `POST /orders` and `GET
/orders/:id`, validates input at the boundary (JSON Schema), writes the
initial order row, and starts a Temporal Workflow keyed by the order ID.
It does no business orchestration itself - it hands that off to Temporal
and returns immediately, which is what makes order creation fast and
decoupled from how long fulfillment actually takes.

**Without it:** clients would need to talk to Temporal or Postgres
directly, coupling every caller to internal infrastructure and giving up a
place to enforce HTTP concerns like input validation, auth, and rate
limiting.

### Temporal Server
Durably persists the state of every Workflow Execution (its Event History)
and dispatches Activity/Workflow tasks to Workers over Task Queues. It is
the piece that makes the fulfillment process durable: if the Worker
crashes, if an Activity fails, if the whole cluster restarts, the Workflow
picks up exactly where it left off because its state lives in Temporal's
database, not in any single process's memory.

**Without it** (see the "Without Temporal" section below), the application
would need to hand-roll all of this itself.

### Temporal UI
A read-only window into Temporal Server's Event History: every Workflow
Execution, every Activity attempt, every retry, every failure, with full
input/output payloads. This is the primary observability tool for *why* an
order is in a given state - see OBSERVABILITY section in the README.

**Without it:** diagnosing a stuck or failed order would mean querying
Temporal's internal gRPC API by hand or grepping Worker logs.

### Order Worker
A separate long-running process that polls the `order-fulfillment` Task
Queue and executes both the Workflow code and the five Activities
(validate, reserve inventory, process payment, confirm, notify). It is
where all actual I/O (SQL queries, the simulated payment) happens - never
inside the Workflow function itself (see WORKFLOW section below for why).

**Without it:** nothing would ever execute - Temporal Server only
orchestrates and persists state, it does not run your code.

### PostgreSQL
The system of record for orders, order items, inventory, and payments.
Plain SQL (via `pg`) rather than an ORM, so the exact queries backing each
business operation stay visible - see DATABASE section in the README.

**Without it:** order/inventory/payment state would have nowhere durable
to live outside of Temporal's own Event History, and there would be no way
to answer ordinary business questions ("how many orders does customer X
have?") with simple SQL.

### Docker / Docker Compose
Packages the API and Worker as identical, reproducible artifacts (a
multi-stage build that ships only compiled JS + production dependencies)
and wires up Postgres + Temporal + Temporal UI + API + Worker as one
`docker compose up` command, both for local development and for the
exe.dev deployment.

**Without it:** every environment (a developer's laptop, CI, the exe.dev
VM) would need its own hand-installed Node/Postgres/Temporal versions,
with no guarantee they match what's actually deployed.

### exe.dev VM
A persistent Linux VM with Docker installed and an HTTPS proxy in front of
it. It is the "production-like runtime" this POC deploys to: a real
always-on host reachable over HTTPS, without needing a cloud provider
account, Kubernetes, or infrastructure-as-code. See the README's
"Deployment to exe.dev" section for the full walkthrough.

## Why Temporal, specifically

### Without Temporal

```text
API
 |
 v
manual state machine  (an orders_state column plus a big switch statement)
 |
 v
database workflow state  (which step are we on? did the last step actually finish?)
 |
 v
custom retry logic  (a cron job or queue consumer that re-scans "stuck" orders)
 |
 v
custom recovery  (reconciling partial failures: was the payment charged before the crash?)
```

Each of those four boxes is a real subsystem you would have to design,
build, test, and operate - and each is a common source of production
incidents (the classic "half-processed order" bug, where a step succeeded
but its result was never recorded, so a retry re-runs it and double-charges
a customer).

### With Temporal

Temporal collapses all four boxes into one thing your team already has to
build anyway: `order.workflow.ts`, which just calls five async functions in
order, wrapped in a `try/catch`. Temporal supplies, for free:

- **Durable state** - the Event History *is* the state machine; there is no
  separate `orders_state` column to keep in sync with reality.
- **Automatic retries** - configured declaratively per Activity (see
  "Activity retry configuration" below), not hand-coded.
- **Crash recovery** - a replaced/restarted Worker resumes exactly where
  the last one left off, because Workflow state lives in Temporal, not in
  the Worker process.
- **Idempotency primitives** - `workflowIdReusePolicy` prevents ever
  starting two Executions for the same order ID.
- **Observability** - the Temporal UI gives you the equivalent of a
  distributed stack trace for every order, for free.

## Observability model

| Signal | Answers | Where in this POC |
|---|---|---|
| **Logs** | What happened, in detail, for one request/order? | Structured JSON via `pino`, with `orderId`/`workflowId`/`activity`/`status`/`durationMs` fields on every important line |
| **Metrics** | How much, how often, trending over time? | Prometheus counters/histograms at `GET /metrics` (API) and the Worker's own `:9464/metrics` |
| **Traces** | Where did time go, across components, for one request? | Out of scope for this POC (see "Production improvements" in the README) - the Temporal UI's Event History serves an equivalent purpose for Workflow-level timing |
| **Temporal UI** | What happened to this specific Workflow Execution - which Activities ran, which retried, which failed, with what payloads? | `http://localhost:8081` |

## Idempotency, end to end

Two independent layers make retried requests/executions safe, so it is
worth being explicit about which layer handles which case:

1. **Duplicate `POST /orders` requests** (e.g. a client's HTTP retry after
   a timeout): handled by Temporal's `workflowIdReusePolicy:
   REJECT_DUPLICATE` on `client.workflow.start()` - Temporal refuses to
   start a second Execution for a Workflow ID that has ever been used. See
   README "Idempotency".
2. **Activity retried by Temporal itself** (e.g. the payment Activity
   times out right after charging but before Temporal records the
   result): handled inside the `processPayment` Activity, which checks for
   an existing payment row (keyed by `orderId`, `UNIQUE` in the schema)
   before "charging" again.

Both layers matter because they protect against different failure modes -
the first is about the caller retrying, the second is about Temporal's
own at-least-once Activity execution guarantee.
