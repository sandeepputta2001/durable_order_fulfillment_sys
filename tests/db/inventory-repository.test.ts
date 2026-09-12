import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, pool } from '../../src/db/client';
import { reserveInventory } from '../../src/db/inventory-repository';
import { InsufficientInventoryError } from '../../src/shared/errors';
import { resetDatabase } from '../test-utils';

async function getAvailableQuantity(productId: string): Promise<number> {
  const result = await pool.query<{ available_quantity: number }>(
    'SELECT available_quantity FROM inventory WHERE product_id = $1',
    [productId],
  );
  return result.rows[0]?.available_quantity ?? -1;
}

describe('inventory repository', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closePool();
  });

  it('decrements available quantity when stock is sufficient', async () => {
    await reserveInventory([{ productId: 'product-1', quantity: 10 }]);
    expect(await getAvailableQuantity('product-1')).toBe(90);
  });

  it('throws InsufficientInventoryError and rolls back the whole reservation', async () => {
    // product-1 has plenty of stock, product-oos has none - the whole
    // reservation must fail atomically, leaving product-1 untouched.
    await expect(
      reserveInventory([
        { productId: 'product-1', quantity: 5 },
        { productId: 'product-oos', quantity: 1 },
      ]),
    ).rejects.toThrow(InsufficientInventoryError);

    expect(await getAvailableQuantity('product-1')).toBe(100);
    expect(await getAvailableQuantity('product-oos')).toBe(0);
  });
});
