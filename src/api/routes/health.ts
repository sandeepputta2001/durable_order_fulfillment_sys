import type { FastifyInstance } from 'fastify';
import { checkDatabaseConnection } from '../../db/client';
import { getTemporalClient } from '../temporal-client';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness: "is the process alive and able to respond at all?" No
  // dependency checks - a slow/unavailable database must NOT make this
  // endpoint fail, or an orchestrator would kill a perfectly healthy
  // process while its only problem is a downstream dependency.
  app.get(
    '/health',
    {
      schema: {
        tags: ['ops'],
        summary: 'Liveness probe',
        description: 'Always returns ok if the process is alive. No dependency checks.',
        response: {
          200: { type: 'object', properties: { status: { type: 'string' } } },
        },
      },
    },
    async () => ({ status: 'ok' }),
  );

  // Readiness: "can this instance actually serve traffic right now?"
  // Checks the dependencies a request needs to succeed. An orchestrator
  // uses this to decide whether to route traffic to this instance, not
  // whether to restart it.
  app.get(
    '/ready',
    {
      schema: {
        tags: ['ops'],
        summary: 'Readiness probe',
        description: 'Checks PostgreSQL connectivity and the Temporal client connection.',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              database: { type: 'string' },
              temporal: { type: 'string' },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              database: { type: 'string' },
              temporal: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const databaseOk = await checkDatabaseConnection();

      let temporalOk = true;
      try {
        getTemporalClient();
      } catch {
        temporalOk = false;
      }

      const ready = databaseOk && temporalOk;
      reply.code(ready ? 200 : 503);
      return {
        status: ready ? 'ok' : 'error',
        database: databaseOk ? 'ok' : 'unavailable',
        temporal: temporalOk ? 'ok' : 'unavailable',
      };
    },
  );
}
