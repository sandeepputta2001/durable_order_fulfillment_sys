CREATE TABLE IF NOT EXISTS order_items (
    id          SERIAL PRIMARY KEY,
    order_id    TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id  TEXT NOT NULL,
    quantity    INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
