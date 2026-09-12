import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processPayment } from '../../src/activities/process-payment';
import { closePool, pool } from '../../src/db/client';
import { createOrder } from '../../src/db/orders-repository';
import { findPaymentByOrderId } from '../../src/db/payments-repository';
import { TransientPaymentError } from '../../src/shared/errors';
import { resetDatabase } from '../test-utils';

describe('processPayment activity', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    delete process.env.PAYMENT_FAILURE_MODE;
  });

  afterAll(async () => {
    await closePool();
  });

  it('charges and records a payment on success', async () => {
    const orderId = `order-${randomUUID()}`;
    await createOrder(orderId, 'customer-1', [{ productId: 'product-1', quantity: 2 }]);

    const result = await processPayment({
      orderId,
      customerId: 'customer-1',
      items: [{ productId: 'product-1', quantity: 2 }],
    });

    expect(result.paymentId).toBeDefined();
    const payment = await findPaymentByOrderId(orderId);
    expect(payment?.status).toBe('SUCCEEDED');
    expect(Number(payment?.amount)).toBeCloseTo(39.98, 2);
  });

  it('throws a transient error when PAYMENT_FAILURE_MODE is enabled, without charging', async () => {
    const orderId = `order-${randomUUID()}`;
    await createOrder(orderId, 'customer-1', [{ productId: 'product-1', quantity: 1 }]);
    process.env.PAYMENT_FAILURE_MODE = 'true';

    await expect(
      processPayment({
        orderId,
        customerId: 'customer-1',
        items: [{ productId: 'product-1', quantity: 1 }],
      }),
    ).rejects.toThrow(TransientPaymentError);

    expect(await findPaymentByOrderId(orderId)).toBeNull();
  });

  it('is idempotent: retrying after a successful charge does not charge again', async () => {
    const orderId = `order-${randomUUID()}`;
    await createOrder(orderId, 'customer-1', [{ productId: 'product-1', quantity: 1 }]);
    const input = {
      orderId,
      customerId: 'customer-1',
      items: [{ productId: 'product-1', quantity: 1 }],
    };

    const first = await processPayment(input);
    const second = await processPayment(input);

    expect(second.paymentId).toBe(first.paymentId);
    const countResult = await pool.query<{ count: string }>(
      'SELECT count(*) FROM payments WHERE order_id = $1',
      [orderId],
    );
    expect(countResult.rows[0]?.count).toBe('1');
  });
});
