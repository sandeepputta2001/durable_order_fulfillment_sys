import type { FastifyInstance } from 'fastify';
import { register } from '../../shared/metrics';

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/metrics',
    {
      schema: {
        tags: ['ops'],
        summary: 'Prometheus metrics',
        description:
          'HTTP and order/activity outcome metrics in Prometheus text exposition format.',
      },
    },
    async (_request, reply) => {
      reply.header('Content-Type', register.contentType);
      return register.metrics();
    },
  );
}
