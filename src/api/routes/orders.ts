import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createOrder, getOrderWithItems } from '../../db/orders-repository';
import { logger } from '../../shared/logger';
import { ordersCreatedTotal } from '../../shared/metrics';
import type { CreateOrderRequest } from '../../shared/types';
import {
  createOrderBodySchema,
  createOrderResponseSchema,
  getOrderParamsSchema,
} from '../schemas/order.schema';
import { startOrderWorkflow } from '../temporal-client';

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateOrderRequest }>(
    '/orders',
    { schema: { body: createOrderBodySchema, response: createOrderResponseSchema } },
    async (request, reply) => {
      const { customerId, items } = request.body;
      // A client-supplied orderId is what makes retried Create Order
      // requests idempotent - see README "Idempotency" and
      // docs/FAILURE_SCENARIOS.md Scenario 4. Without one, each request is
      // treated as a genuinely new order.
      const orderId = request.body.orderId ?? `order-${randomUUID()}`;

      const { order } = await createOrder(orderId, customerId, items);
      const { started } = await startOrderWorkflow({ orderId, customerId, items });

      if (started) {
        ordersCreatedTotal.inc();
      }

      logger.info(
        { orderId, workflowId: orderId, status: order.status, workflowStarted: started },
        'create order request handled',
      );

      const latest = await getOrderWithItems(orderId);
      reply.code(started ? 201 : 200);
      return { orderId, status: latest?.status ?? order.status };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/orders/:id',
    { schema: { params: getOrderParamsSchema } },
    async (request, reply) => {
      const order = await getOrderWithItems(request.params.id);
      if (!order) {
        reply.code(404);
        return { error: 'not_found', message: `Order ${request.params.id} not found` };
      }
      return {
        id: order.id,
        customerId: order.customerId,
        status: order.status,
        items: order.items,
      };
    },
  );
}
