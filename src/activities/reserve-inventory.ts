import { reserveInventory as reserveInventoryInDb } from '../db/inventory-repository';
import { updateOrderStatus } from '../db/orders-repository';
import { logger } from '../shared/logger';
import { withActivityMetrics } from '../shared/metrics';
import type { OrderWorkflowInput } from '../shared/types';

/**
 * Reserves inventory for every line item in a single DB transaction. Throws
 * InsufficientInventoryError (a BusinessError, non-retryable) if stock is
 * not available - see src/db/inventory-repository.ts for the locking
 * strategy that keeps concurrent reservations safe.
 */
export const reserveInventory = withActivityMetrics(
  'reserveInventory',
  async (input: OrderWorkflowInput) => {
    const start = Date.now();
    await reserveInventoryInDb(input.items);
    await updateOrderStatus(input.orderId, 'INVENTORY_RESERVED');

    logger.info(
      {
        orderId: input.orderId,
        activity: 'reserveInventory',
        status: 'ok',
        durationMs: Date.now() - start,
      },
      'inventory reserved',
    );
  },
);
