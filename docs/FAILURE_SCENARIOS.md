# Failure Scenarios

This document walks through the five failure scenarios this POC is
designed to demonstrate, with exact commands. Run these against a stack
started with `make up` (or `docker compose up --build -d`).

Throughout, `<ORDER_ID>` is the `orderId` returned by `POST /orders`.

## Scenario 1: Worker crashes mid-fulfillment

**Setup:** create an order, then kill the Worker process before it
finishes.

```bash
curl -X POST http://localhost:8085/orders \
  -H "Content-Type: application/json" \
  -d '{"customerId": "customer-1", "items": [{"productId": "product-1", "quantity": 1}]}'
# note the orderId, then immediately:
docker compose kill worker
```

**Expected:** The order is stuck (not yet CONFIRMED) while the Worker is
down - check with `GET /orders/<ORDER_ID>` and in the Temporal UI
(`http://localhost:8081`), where the Workflow Execution is still "Running"
with no progress. Nothing is lost, because Workflow state lives in
Temporal's Event History, not in the Worker's memory.

```bash
docker compose up -d worker
```

**Result:** Within seconds, the restarted Worker picks up the Task Queue
again, the Workflow resumes from the last completed step (not from the
beginning - already-completed Activities are never re-run), and the order
reaches `CONFIRMED`. Confirm with `GET /orders/<ORDER_ID>`.

## Scenario 2: Payment Activity fails transiently, then Temporal retries it

**Setup:** enable the failure simulation, recreate the Worker, create an
order.

```bash
make demo-fail
# or manually: sed -i 's/PAYMENT_FAILURE_MODE=.*/PAYMENT_FAILURE_MODE=true/' .env && docker compose up -d worker

curl -X POST http://localhost:8085/orders \
  -H "Content-Type: application/json" \
  -d '{"customerId": "customer-2", "items": [{"productId": "product-1", "quantity": 1}]}'
```

**Expected:** Open the Workflow Execution in the Temporal UI. You will see
the `processPayment` Activity recorded as failing with
`TransientPaymentError`, then automatically scheduled again after a
backoff delay (1s, 2s, 4s, 8s, 10s - see `order.workflow.ts`'s
`paymentActivityOptions`). `GET /orders/<ORDER_ID>` shows status stuck at
`PAYMENT_PROCESSING`. No code in this repository implements that retry
loop - it is entirely Temporal's Activity retry policy.

## Scenario 3: Payment keeps failing until retries are exhausted

**Setup:** continuing from Scenario 2, simply wait (leave
`PAYMENT_FAILURE_MODE=true`).

**Expected:** After 6 attempts (the `maximumAttempts` configured for the
payment Activity - roughly 30-60 seconds of backoff), Temporal stops
retrying and fails the Activity permanently. The Workflow's `catch` block
runs `markOrderFailed`, and:

```bash
curl http://localhost:8085/orders/<ORDER_ID>
# { "status": "FAILED", ... }
```

This demonstrates that Temporal does **not** retry forever - it fails
closed after a bounded, configured number of attempts, exactly like it
would fail a genuinely broken payment provider integration.

## Scenario 4: Duplicate Create Order request (idempotency)

**Setup:** send the exact same request twice, with the same client-chosen
`orderId`.

```bash
curl -X POST http://localhost:8085/orders \
  -H "Content-Type: application/json" \
  -d '{"orderId": "order-demo-1", "customerId": "customer-3", "items": [{"productId": "product-2", "quantity": 1}]}'

curl -X POST http://localhost:8085/orders \
  -H "Content-Type: application/json" \
  -d '{"orderId": "order-demo-1", "customerId": "customer-3", "items": [{"productId": "product-2", "quantity": 1}]}'
```

**Expected:** The first request returns `201` and starts exactly one
Workflow Execution with Workflow ID `order-demo-1`. The second request
returns `200` (not `201`) with the order's current status - Temporal
rejected starting a second Execution for the same Workflow ID
(`workflowIdReusePolicy: REJECT_DUPLICATE`), and the API caught that and
returned the existing order's state instead of erroring. Confirm in the
Temporal UI: only one Workflow Execution exists for `order-demo-1`, and
check the `payments` table has at most one row for it even if you also
retried after payment had already succeeded (see README "Idempotency" for
the payment-level idempotency check).

## Scenario 5: Insufficient inventory (business failure, not retried)

**Setup:** order more of `product-oos` than is in stock (it is seeded with
`0` available quantity specifically for this demo - see
`005_seed_inventory.sql`).

```bash
curl -X POST http://localhost:8085/orders \
  -H "Content-Type: application/json" \
  -d '{"customerId": "customer-4", "items": [{"productId": "product-oos", "quantity": 1}]}'
```

**Expected:** `reserveInventory` throws `InsufficientInventoryError`,
which is listed in `NON_RETRYABLE_ERROR_TYPES` - Temporal fails the
Activity on the **first** attempt with no retries at all (visible in the
Temporal UI: exactly one Activity attempt, not several with backoff). The
Workflow's `catch` block marks the order `FAILED` immediately:

```bash
curl http://localhost:8085/orders/<ORDER_ID>
# { "status": "FAILED", ... }
```

This is the direct contrast with Scenario 2/3: a **business** failure
(the answer is definitively "no," retrying changes nothing) fails fast,
while a **transient** failure (the answer might become "yes" later) is
retried with backoff. See `src/shared/errors.ts` for how the two are
distinguished.

## Cleanup between demos

```bash
make demo-fix   # sets PAYMENT_FAILURE_MODE=false and recreates the worker
```
