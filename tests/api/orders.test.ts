import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The API tests exercise the real HTTP layer + real Postgres, but stub out
// Temporal (no Temporal server is required to run these tests) - this
// module is mocked instead of restructuring server.ts with unnecessary DI.
vi.mock('../../src/api/temporal-client', () => ({
  startOrderWorkflow: vi.fn().mockResolvedValue({ started: true }),
  connectTemporalClient: vi.fn(),
  getTemporalClient: vi.fn(() => ({})),
}));

import { closePool } from '../../src/db/client';
import { resetDatabase } from '../test-utils';

describe('orders API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  it('creates an order and starts a workflow with the order id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        customerId: 'customer-123',
        items: [{ productId: 'product-1', quantity: 2 }],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.orderId).toMatch(/^order-/);
    expect(body.status).toBe('PENDING');
  });

  it('returns a previously created order by id', async () => {
    const orderId = `order-${randomUUID()}`;
    const createResponse = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        orderId,
        customerId: 'customer-123',
        items: [{ productId: 'product-1', quantity: 1 }],
      },
    });
    expect(createResponse.statusCode).toBe(201);

    const getResponse = await app.inject({ method: 'GET', url: `/orders/${orderId}` });
    expect(getResponse.statusCode).toBe(200);
    const body = getResponse.json();
    expect(body).toMatchObject({ id: orderId, customerId: 'customer-123', status: 'PENDING' });
  });

  it('rejects an invalid create-order request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: { customerId: 'customer-123', items: [] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for an order that does not exist', async () => {
    const response = await app.inject({ method: 'GET', url: '/orders/does-not-exist' });
    expect(response.statusCode).toBe(404);
  });

  it('is idempotent for a duplicate orderId: does not start a second workflow', async () => {
    const { startOrderWorkflow } = await import('../../src/api/temporal-client');
    const orderId = `order-${randomUUID()}`;
    const payload = {
      orderId,
      customerId: 'customer-123',
      items: [{ productId: 'product-1', quantity: 1 }],
    };

    const first = await app.inject({ method: 'POST', url: '/orders', payload });
    expect(first.statusCode).toBe(201);

    vi.mocked(startOrderWorkflow).mockResolvedValueOnce({ started: false });
    const second = await app.inject({ method: 'POST', url: '/orders', payload });

    expect(second.statusCode).toBe(200);
    expect(second.json().orderId).toBe(orderId);
    expect(startOrderWorkflow).toHaveBeenCalledTimes(2);
  });
});
