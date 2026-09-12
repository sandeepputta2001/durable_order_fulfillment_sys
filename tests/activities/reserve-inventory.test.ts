import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { reserveInventory } from '../../src/activities/reserve-inventory';
import { closePool } from '../../src/db/client';
import { createOrder, getOrderWithItems } from '../../src/db/orders-repository';
import { InsufficientInventoryError } from '../../src/shared/errors';
import { resetDatabase } from '../test-utils';

describe('reserveInventory activity', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closePool();
  });

  it('reserves stock and moves the order to INVENTORY_RESERVED', async () => {
    const orderId = `order-${randomUUID()}`;
    await createOrder(orderId, 'customer-1', [{ productId: 'product-1', quantity: 3 }]);

    await reserveInventory({
      orderId,
      customerId: 'customer-1',
      items: [{ productId: 'product-1', quantity: 3 }],
    });

    const order = await getOrderWithItems(orderId);
    expect(order?.status).toBe('INVENTORY_RESERVED');
  });

  it('throws a non-retryable business error for insufficient stock', async () => {
    const orderId = `order-${randomUUID()}`;
    await createOrder(orderId, 'customer-1', [{ productId: 'product-oos', quantity: 1 }]);

    await expect(
      reserveInventory({
        orderId,
        customerId: 'customer-1',
        items: [{ productId: 'product-oos', quantity: 1 }],
      }),
    ).rejects.toThrow(InsufficientInventoryError);

    // Status stays at whatever it was before this activity ran (PENDING) -
    // the Workflow itself is responsible for marking the order FAILED.
    const order = await getOrderWithItems(orderId);
    expect(order?.status).toBe('PENDING');
  });
});
