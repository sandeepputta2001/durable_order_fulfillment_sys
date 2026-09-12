import { findPaymentByOrderId, recordPayment } from '../db/payments-repository';
import { updateOrderStatus } from '../db/orders-repository';
import { loadConfig } from '../config/config';
import { TransientPaymentError } from '../shared/errors';
import { logger } from '../shared/logger';
import { withActivityMetrics } from '../shared/metrics';
import { calculateOrderTotal } from '../shared/pricing';
import type { OrderWorkflowInput } from '../shared/types';

/**
 * Simulated payment activity - the centerpiece of the failure-simulation
 * and idempotency demos (see docs/FAILURE_SCENARIOS.md).
 *
 * Idempotency: Temporal guarantees at-least-once Activity execution, which
 * means this function's *code* could run more than once for the same
 * order (e.g. if the Activity times out right after the charge succeeds
 * but before Temporal records the result, it will be retried). We make
 * that safe by checking for an existing payment row (keyed by orderId,
 * UNIQUE in the schema) before "charging", and by using an idempotent
 * insert as a last line of defense. The real charge only ever happens once
 * per order no matter how many times this Activity is retried.
 *
 * Failure simulation: when PAYMENT_FAILURE_MODE=true, every attempt throws
 * a TransientPaymentError (simulating a payment gateway outage) instead of
 * recording a payment. This is a transient/infrastructure-style error, so
 * Temporal's Activity retry policy keeps retrying with exponential backoff
 * - the order stays durably "in flight" without any manual state machine
 * or retry loop in application code. Flipping PAYMENT_FAILURE_MODE back to
 * false and letting the Worker pick it up lets the very next retry attempt
 * succeed and the Workflow continues exactly where it left off.
 */
export const processPayment = withActivityMetrics(
  'processPayment',
  async (input: OrderWorkflowInput): Promise<{ paymentId: number }> => {
    const start = Date.now();
    // Re-read on every invocation (rather than a module-level singleton) so
    // this is dynamically testable and, in the same way, a Worker restart
    // (see docs/FAILURE_SCENARIOS.md) always reflects the current env value.
    const config = loadConfig();
    await updateOrderStatus(input.orderId, 'PAYMENT_PROCESSING');

    const existing = await findPaymentByOrderId(input.orderId);
    if (existing) {
      logger.info(
        { orderId: input.orderId, activity: 'processPayment', status: 'skipped-already-paid' },
        'payment already recorded, skipping charge (idempotent)',
      );
      return { paymentId: existing.id };
    }

    if (config.paymentFailureMode) {
      logger.warn(
        { orderId: input.orderId, activity: 'processPayment', status: 'failed-simulated' },
        'simulated payment gateway failure (PAYMENT_FAILURE_MODE=true)',
      );
      throw new TransientPaymentError(
        'Payment gateway temporarily unavailable (simulated failure mode)',
      );
    }

    const amount = calculateOrderTotal(input.items);
    const payment = await recordPayment(input.orderId, amount);

    logger.info(
      {
        orderId: input.orderId,
        activity: 'processPayment',
        status: 'ok',
        durationMs: Date.now() - start,
      },
      `payment of $${amount.toFixed(2)} charged`,
    );

    return { paymentId: payment.id };
  },
);
