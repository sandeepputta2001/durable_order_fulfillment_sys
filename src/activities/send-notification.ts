import { logger } from '../shared/logger';
import { withActivityMetrics } from '../shared/metrics';

/**
 * Simulated notification side effect. Deliberately just logs - a real
 * implementation would call an email/SMS/push provider. It is still a
 * Temporal Activity (not inline Workflow code) because it is external I/O,
 * and the Workflow orchestrates it alongside payment/inventory as one more
 * durable side effect in the fulfillment process.
 */
export const sendNotification = withActivityMetrics('sendNotification', async (orderId: string) => {
  logger.info(
    { orderId, activity: 'sendNotification', status: 'ok' },
    `Order ${orderId} confirmation notification sent`,
  );
});
