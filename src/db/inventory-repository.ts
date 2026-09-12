import type { PoolClient } from 'pg';
import { withTransaction } from './client';
import { InsufficientInventoryError } from '../shared/errors';
import type { OrderItemInput } from '../shared/types';

/**
 * Reserves (decrements) inventory for every line item of an order inside a
 * single transaction: either all items are reserved or none are.
 *
 * `SELECT ... FOR UPDATE` locks each inventory row for the duration of the
 * transaction so two concurrent reservations for the same product cannot
 * both read the same available_quantity and oversell it.
 *
 * Insufficient stock is a permanent business failure, not a transient one -
 * retrying the exact same reservation will never succeed, so we throw
 * InsufficientInventoryError, which the Workflow's Activity retry policy is
 * configured to treat as non-retryable.
 */
export async function reserveInventory(items: OrderItemInput[]): Promise<void> {
  await withTransaction(async (client: PoolClient) => {
    for (const item of items) {
      const result = await client.query<{ available_quantity: number }>(
        'SELECT available_quantity FROM inventory WHERE product_id = $1 FOR UPDATE',
        [item.productId],
      );
      const row = result.rows[0];
      const available = row?.available_quantity ?? 0;

      if (available < item.quantity) {
        throw new InsufficientInventoryError(item.productId, item.quantity, available);
      }

      await client.query(
        'UPDATE inventory SET available_quantity = available_quantity - $1 WHERE product_id = $2',
        [item.quantity, item.productId],
      );
    }
  });
}
