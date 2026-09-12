-- Idempotency: order_id is UNIQUE, so the payment activity can safely be
-- retried by Temporal (at-least-once execution) without ever charging an
-- order twice. See docs/ARCHITECTURE.md "Idempotency" section.
CREATE TABLE IF NOT EXISTS payments (
    id          SERIAL PRIMARY KEY,
    order_id    TEXT NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
    amount      NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    status      TEXT NOT NULL CHECK (status IN ('SUCCEEDED')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
