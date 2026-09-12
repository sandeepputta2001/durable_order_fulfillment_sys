import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from '@temporalio/worker';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InsufficientInventoryError, TransientPaymentError } from '../../src/shared/errors';
import type { OrderWorkflowInput } from '../../src/shared/types';

// Temporal's Worker bundles the workflow file itself (via webpack), so it
// just needs a plain absolute path - not a Node-resolved module id. We
// build that path manually (with the .ts extension) rather than using
// require.resolve, which under Vitest's ESM test runner can't resolve a
// bare TypeScript source file the way ts-node/tsx's require hook would.
const workflowsPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/workflows/order.workflow.ts',
);

/**
 * Workflow tests use Temporal's own test environment: the real Workflow
 * code (order.workflow.ts) runs against a real (ephemeral, time-skipping)
 * Temporal server, with mocked Activity implementations standing in for
 * the database/payment/notification side effects. This verifies the
 * Workflow's *orchestration* logic - the order Activities run in, how it
 * reacts to failures - independently of the real database or payment
 * simulation, which are covered by the activity-level tests instead.
 */
describe('orderFulfillmentWorkflow', () => {
  let testEnv: TestWorkflowEnvironment;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  }, 120_000);

  afterAll(async () => {
    await testEnv?.teardown();
  });

  function input(orderId: string): OrderWorkflowInput {
    return {
      orderId,
      customerId: 'customer-1',
      items: [{ productId: 'product-1', quantity: 1 }],
    };
  }

  it('runs validate -> reserve -> pay -> confirm -> notify on the happy path', async () => {
    const calls: string[] = [];
    const mockActivities = {
      validateOrder: vi.fn(async () => {
        calls.push('validateOrder');
      }),
      reserveInventory: vi.fn(async () => {
        calls.push('reserveInventory');
      }),
      processPayment: vi.fn(async () => {
        calls.push('processPayment');
        return { paymentId: 1 };
      }),
      confirmOrder: vi.fn(async () => {
        calls.push('confirmOrder');
      }),
      sendNotification: vi.fn(async () => {
        calls.push('sendNotification');
      }),
      markOrderFailed: vi.fn(async () => {
        calls.push('markOrderFailed');
      }),
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test-happy-path',
      workflowsPath,
      activities: mockActivities,
    });

    const orderId = `order-${randomUUID()}`;
    const result = await worker.runUntil(
      testEnv.client.workflow.execute('orderFulfillmentWorkflow', {
        workflowId: orderId,
        taskQueue: 'test-happy-path',
        args: [input(orderId)],
      }),
    );

    expect(result).toEqual({ orderId, status: 'CONFIRMED', paymentId: '1' });
    expect(calls).toEqual([
      'validateOrder',
      'reserveInventory',
      'processPayment',
      'confirmOrder',
      'sendNotification',
    ]);
  });

  it('marks the order FAILED without retrying a non-retryable business error', async () => {
    const mockActivities = {
      validateOrder: vi.fn(async () => {}),
      reserveInventory: vi.fn(async () => {
        throw new InsufficientInventoryError('product-1', 1, 0);
      }),
      processPayment: vi.fn(async () => ({ paymentId: 1 })),
      confirmOrder: vi.fn(async () => {}),
      sendNotification: vi.fn(async () => {}),
      markOrderFailed: vi.fn(async () => {}),
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test-business-failure',
      workflowsPath,
      activities: mockActivities,
    });

    const orderId = `order-${randomUUID()}`;
    const result = await worker.runUntil(
      testEnv.client.workflow.execute('orderFulfillmentWorkflow', {
        workflowId: orderId,
        taskQueue: 'test-business-failure',
        args: [input(orderId)],
      }),
    );

    expect(result.status).toBe('FAILED');
    // Non-retryable: reserveInventory must have been attempted exactly
    // once, not retried.
    expect(mockActivities.reserveInventory).toHaveBeenCalledTimes(1);
    expect(mockActivities.processPayment).not.toHaveBeenCalled();
    expect(mockActivities.markOrderFailed).toHaveBeenCalledTimes(1);
  });

  it('retries a transient payment failure and succeeds once it stops failing', async () => {
    let attempts = 0;
    const mockActivities = {
      validateOrder: vi.fn(async () => {}),
      reserveInventory: vi.fn(async () => {}),
      processPayment: vi.fn(async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new TransientPaymentError('simulated gateway outage');
        }
        return { paymentId: 42 };
      }),
      confirmOrder: vi.fn(async () => {}),
      sendNotification: vi.fn(async () => {}),
      markOrderFailed: vi.fn(async () => {}),
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: 'test-transient-retry',
      workflowsPath,
      activities: mockActivities,
    });

    const orderId = `order-${randomUUID()}`;
    const result = await worker.runUntil(
      testEnv.client.workflow.execute('orderFulfillmentWorkflow', {
        workflowId: orderId,
        taskQueue: 'test-transient-retry',
        args: [input(orderId)],
      }),
    );

    expect(result.status).toBe('CONFIRMED');
    expect(attempts).toBe(3);
    expect(mockActivities.confirmOrder).toHaveBeenCalledTimes(1);
  });
});
