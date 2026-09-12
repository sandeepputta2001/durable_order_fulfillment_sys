import { pool } from '../src/db/client';

/**
 * Resets the tables touched by tests back to a known state. Runs between
 * tests instead of dropping/recreating the schema, which keeps the test
 * suite fast.
 */
export async function resetDatabase(): Promise<void> {
  await pool.query('TRUNCATE TABLE payments, order_items, orders RESTART IDENTITY CASCADE');
  await pool.query(`
    UPDATE inventory SET available_quantity = CASE product_id
      WHEN 'product-1' THEN 100
      WHEN 'product-2' THEN 50
      WHEN 'product-3' THEN 25
      WHEN 'product-oos' THEN 0
      ELSE available_quantity
    END
  `);
}
