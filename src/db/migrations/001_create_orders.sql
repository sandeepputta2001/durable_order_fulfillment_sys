CREATE TABLE IF NOT EXISTS orders (
    id           TEXT PRIMARY KEY,
    customer_id  TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (
        status IN (
            'PENDING',
            'VALIDATING',
            'INVENTORY_RESERVED',
            'PAYMENT_PROCESSING',
            'CONFIRMED',
            'FAILED'
        )
    ),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
