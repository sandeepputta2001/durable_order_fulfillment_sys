CREATE TABLE IF NOT EXISTS inventory (
    product_id         TEXT PRIMARY KEY,
    available_quantity INTEGER NOT NULL CHECK (available_quantity >= 0)
);
