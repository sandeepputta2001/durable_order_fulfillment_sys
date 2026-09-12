import Fastify, { type FastifyInstance } from 'fastify';
import { config } from '../config/config';
import { runMigrations } from '../db/migrate';
import { logger } from '../shared/logger';
import { httpRequestDurationSeconds, httpRequestsTotal } from '../shared/metrics';
import { retryConnect } from '../shared/retry-connect';
import { healthRoutes } from './routes/health';
import { metricsRoutes } from './routes/metrics';
import { orderRoutes } from './routes/orders';
import { connectTemporalClient } from './temporal-client';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? request.url;
    const labels = { method: request.method, route, status_code: String(reply.statusCode) };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, reply.elapsedTime / 1000);

    logger.info(
      {
        method: request.method,
        route,
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      'request completed',
    );
  });

  await app.register(orderRoutes);
  await app.register(healthRoutes);
  await app.register(metricsRoutes);

  return app;
}

async function main(): Promise<void> {
  await retryConnect(() => runMigrations(), { label: 'Postgres (migrations)' });
  await connectTemporalClient();

  const app = await buildServer();
  await app.listen({ host: '0.0.0.0', port: config.port });
  logger.info({ port: config.port }, 'API server listening');
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ error: (err as Error).message }, 'API server failed to start');
    process.exit(1);
  });
}
