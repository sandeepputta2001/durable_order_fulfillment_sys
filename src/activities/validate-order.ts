import { updateOrderStatus } from '../db/orders-repository';
import { InvalidOrderError } from '../shared/errors';
import { logger } from '../shared/logger';
import { withActivityMetrics } from '../shared/metrics';
import type { OrderWorkflowInput } from '../shared/types';

/**
 * Validates the order's business data and moves it into the VALIDATING
 * status. An invalid order (missing customer, empty item list, non-positive
 * quantity) is a permanent business error - retrying it would produce the
 * same result, so we throw InvalidOrderError, which the Workflow's retry
 * policy treats as non-retryable.
 */
export const validateOrder = withActivityMetrics(
  'validateOrder',
  async (input: OrderWorkflowInput) => {
    const start = Date.now();
    await updateOrderStatus(input.orderId, 'VALIDATING');

    if (!input.customerId || input.customerId.trim().length === 0) {
      throw new InvalidOrderError('customerId is required');
    }
    if (!input.items || input.items.length === 0) {
      throw new InvalidOrderError('order must contain at least one item');
    }
    for (const item of input.items) {
      if (!item.productId || item.productId.trim().length === 0) {
        throw new InvalidOrderError('each item requires a productId');
      }
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new InvalidOrderError(`quantity for ${item.productId} must be a positive integer`);
      }
    }

    logger.info(
      {
        orderId: input.orderId,
        activity: 'validateOrder',
        status: 'ok',
        durationMs: Date.now() - start,
      },
      'order validated',
    );
  },
);
