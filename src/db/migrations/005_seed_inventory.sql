-- Seed data for the demo. product-1..product-3 have stock; product-oos is
-- deliberately out of stock so the insufficient-inventory business-failure
-- path (see docs/FAILURE_SCENARIOS.md, Scenario 5) can be demonstrated.
INSERT INTO inventory (product_id, available_quantity)
VALUES
    ('product-1', 100),
    ('product-2', 50),
    ('product-3', 25),
    ('product-oos', 0)
ON CONFLICT (product_id) DO NOTHING;
