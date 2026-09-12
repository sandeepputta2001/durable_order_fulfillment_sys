import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '../../src/db/client';
import { createOrder, getOrderWithItems, updateOrderStatus } from '../../src/db/orders-repository';
import { resetDatabase } from '../test-utils';

describe('orders repository', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closePool();
  });

  it('creates an order and its items in a single transaction', async () => {
    const orderId = `order-${randomUUID()}`;
    const { order, created } = await createOrder(orderId, 'customer-1', [
      { productId: 'product-1', quantity: 2 },
      { productId: 'product-2', quantity: 1 },
    ]);

    expect(created).toBe(true);
    expect(order.status).toBe('PENDING');

    const fetched = await getOrderWithItems(orderId);
    expect(fetched).not.toBeNull();
    expect(fetched?.customerId).toBe('customer-1');
    expect(fetched?.items).toHaveLength(2);
    expect(fetched?.items.map((item) => item.productId).sort()).toEqual(['product-1', 'product-2']);
  });

  it('is idempotent when the same orderId is created twice', async () => {
    const orderId = `order-${randomUUID()}`;
    const first = await createOrder(orderId, 'customer-1', [
      { productId: 'product-1', quantity: 1 },
    ]);
    const second = await createOrder(orderId, 'customer-1', [
      { productId: 'product-1', quantity: 99 },
    ]);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const fetched = await getOrderWithItems(orderId);
    // Second call's (different) items must NOT have been inserted.
    expect(fetched?.items).toHaveLength(1);
    expect(fetched?.items[0]?.quantity).toBe(1);
  });

  it('returns null for an order that does not exist', async () => {
    const fetched = await getOrderWithItems('does-not-exist');
    expect(fetched).toBeNull();
  });

  it('updates order status', async () => {
    const orderId = `order-${randomUUID()}`;
    await createOrder(orderId, 'customer-1', [{ productId: 'product-1', quantity: 1 }]);

    await updateOrderStatus(orderId, 'CONFIRMED');

    const fetched = await getOrderWithItems(orderId);
    expect(fetched?.status).toBe('CONFIRMED');
  });
});
