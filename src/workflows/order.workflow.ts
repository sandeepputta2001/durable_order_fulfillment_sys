import { proxyActivities, log } from '@temporalio/workflow';
import type * as activities from '../activities';
import { NON_RETRYABLE_ERROR_TYPES } from '../shared/errors';
import type { OrderWorkflowInput, OrderWorkflowResult } from '../shared/types';

/**
 * orderFulfillmentWorkflow - the durable business process for one order.
 *
 * WHY THIS CODE MUST BE DETERMINISTIC
 * Temporal does not store a running process image. Instead it records every
 * event (Activity scheduled, Activity completed, timer fired, ...) in a
 * persisted Event History, and "resumes" a Workflow by replaying that
 * history through this same function from the top, on any Worker, at any
 * time. If this function's logic could produce different decisions given
 * the same history (e.g. by calling Date.now(), Math.random(), reading a
 * file, or awaiting a raw network call), replay would diverge from what
 * actually happened and Temporal would not be able to safely resume the
 * Workflow. That is why all non-deterministic work - every database call,
 * every "external side effect" - lives in Activities, invoked here only
 * through the proxies below, never inline.
 *
 * WHAT TEMPORAL PERSISTS / HOW IT RESUMES
 * Every state transition of this Workflow (which Activity was scheduled,
 * what it returned, what failed) is appended to the Workflow's Event
 * History in Temporal's database. If the Worker process hosting this
 * Workflow crashes or is redeployed, Temporal simply hands the same
 * Workflow ID's task to any available Worker polling the same Task Queue;
 * that Worker replays the Event History to reconstruct in-memory state up
 * to where execution left off, then continues from the next un-completed
 * step. No application code has to persist "what step are we on" - that is
 * exactly what would otherwise require a hand-rolled state machine table.
 *
 * WHAT HAPPENS IF THE WORKER CRASHES
 * In-flight Activities are re-dispatched (subject to their own retry
 * policy/timeouts) once a Worker is available again; the Workflow itself is
 * untouched because its state lives in Temporal's Event History, not in the
 * crashed process's memory.
 *
 * WHAT HAPPENS IF AN ACTIVITY FAILS
 * Each Activity has its own Retry Policy (see the two proxies below).
 * Transient errors (plain Error / TransientPaymentError) are retried with
 * exponential backoff up to the configured number of attempts. Business
 * errors (BusinessError and its subclasses, listed in
 * NON_RETRYABLE_ERROR_TYPES) are never retried - they fail the Activity
 * immediately, which this Workflow catches below and turns into a FAILED
 * order. If a transient error exhausts all retry attempts, it fails the
 * same way.
 */

const standardActivityOptions = {
  startToCloseTimeout: '10 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
    maximumAttempts: 3,
    nonRetryableErrorTypes: NON_RETRYABLE_ERROR_TYPES,
  },
} as const;

/**
 * The payment Activity gets a more generous retry budget than the other
 * steps. This is deliberate: it is the Activity used to demonstrate
 * PAYMENT_FAILURE_MODE (see docs/FAILURE_SCENARIOS.md), and a short retry budget
 * would exhaust itself before a human operator has time to disable the
 * failure mode and watch the very next attempt succeed. Six attempts with
 * a 10s interval cap gives roughly 30-60 seconds of retrying - enough for a
 * live demo - before the Workflow gives up and the order is marked FAILED
 * (which itself demonstrates that Temporal does not retry forever).
 */
const paymentActivityOptions = {
  startToCloseTimeout: '10 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
    maximumAttempts: 6,
    nonRetryableErrorTypes: NON_RETRYABLE_ERROR_TYPES,
  },
} as const;

const standard = proxyActivities<typeof activities>(standardActivityOptions);
const payment = proxyActivities<typeof activities>(paymentActivityOptions);

export async function orderFulfillmentWorkflow(
  input: OrderWorkflowInput,
): Promise<OrderWorkflowResult> {
  log.info('order fulfillment workflow started', { orderId: input.orderId });

  try {
    await standard.validateOrder(input);
    await standard.reserveInventory(input);
    const { paymentId } = await payment.processPayment(input);
    await standard.confirmOrder(input.orderId);
    await standard.sendNotification(input.orderId);

    log.info('order fulfillment workflow completed', { orderId: input.orderId });
    return { orderId: input.orderId, status: 'CONFIRMED', paymentId: String(paymentId) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    log.error('order fulfillment workflow failed', { orderId: input.orderId, error: reason });
    await standard.markOrderFailed(input.orderId, reason);
    return { orderId: input.orderId, status: 'FAILED' };
  }
}
