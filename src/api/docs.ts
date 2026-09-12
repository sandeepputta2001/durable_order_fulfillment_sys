import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

/**
 * Generates an OpenAPI (Swagger) spec directly from the JSON Schemas
 * already attached to each route (see src/api/schemas/) and serves an
 * interactive UI for it. No schema is duplicated - this is the same
 * schema Fastify uses to validate requests, so the docs can't drift out
 * of sync with what the API actually accepts.
 */
export async function registerApiDocs(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Durable Order Fulfillment System API',
        description:
          'REST API for the Durable Order Fulfillment System POC. Creating an order starts a ' +
          'Temporal Workflow (orderFulfillmentWorkflow) that durably runs it through validation, ' +
          'inventory reservation, payment, confirmation, and notification - see docs/ARCHITECTURE.md.',
        version: '1.0.0',
      },
      tags: [
        { name: 'orders', description: 'Create, list, and look up orders' },
        { name: 'ops', description: 'Health, readiness, and metrics' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });
}
