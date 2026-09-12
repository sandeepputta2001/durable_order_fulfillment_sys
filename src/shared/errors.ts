/**
 * Error taxonomy shared between Activities and the Workflow.
 *
 * Temporal Activities distinguish between two broad classes of failure:
 *
 *  - Transient / infrastructure errors: the kind of thing that might succeed
 *    if you just try again (a flaky network call, a database connection
 *    blip, a downstream service returning a 503). These SHOULD be retried
 *    automatically by Temporal's Activity retry policy.
 *
 *  - Permanent / business errors: the operation is well-formed and was
 *    executed correctly, but the answer is "no" for a business reason that
 *    will not change on retry (insufficient inventory, invalid order,
 *    payment declined for fraud). Retrying these forever wastes resources
 *    and never converges - Temporal must NOT retry them.
 *
 * We model this by throwing a plain Error for transient failures (the
 * default Activity retry policy will retry these) and a `BusinessError`
 * subclass for permanent failures. The Activity retry policy's
 * `nonRetryableErrorTypes` list references `BusinessError` (and its named
 * subclasses) by name so Temporal stops retrying immediately.
 */
export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessError';
  }
}

export class InsufficientInventoryError extends BusinessError {
  constructor(productId: string, requested: number, available: number) {
    super(
      `Insufficient inventory for product ${productId}: requested ${requested}, available ${available}`,
    );
    this.name = 'InsufficientInventoryError';
  }
}

export class InvalidOrderError extends BusinessError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOrderError';
  }
}

export class PaymentDeclinedError extends BusinessError {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentDeclinedError';
  }
}

/**
 * Thrown by the simulated payment activity when PAYMENT_FAILURE_MODE=true.
 * This represents a transient infrastructure failure (e.g. the payment
 * gateway is temporarily unreachable) and is intentionally NOT a
 * BusinessError, so Temporal's default Activity retry policy retries it.
 */
export class TransientPaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientPaymentError';
  }
}

export const NON_RETRYABLE_ERROR_TYPES = [
  'BusinessError',
  'InsufficientInventoryError',
  'InvalidOrderError',
  'PaymentDeclinedError',
];
