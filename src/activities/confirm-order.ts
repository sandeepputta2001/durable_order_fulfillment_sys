import { updateOrderStatus } from '../db/orders-repository';
import { logger } from '../shared/logger';
import { ordersConfirmedTotal, ordersFailedTotal, withActivityMetrics } from '../shared/metrics';

export const confirmOrder = withActivityMetrics('confirmOrder', async (orderId: string) => {
  await updateOrderStatus(orderId, 'CONFIRMED');
  ordersConfirmedTotal.inc();
  logger.info({ orderId, activity: 'confirmOrder', status: 'ok' }, 'order confirmed');
});

export const markOrderFailed = withActivityMetrics(
  'markOrderFailed',
  async (orderId: string, reason: string) => {
    await updateOrderStatus(orderId, 'FAILED');
    ordersFailedTotal.inc();
    logger.error(
      { orderId, activity: 'markOrderFailed', status: 'ok', error: reason },
      'order marked as failed',
    );
  },
);
