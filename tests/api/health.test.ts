import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/temporal-client', () => ({
  startOrderWorkflow: vi.fn(),
  connectTemporalClient: vi.fn(),
  getTemporalClient: vi.fn(() => ({})),
}));

import { closePool } from '../../src/db/client';

describe('health endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildServer } = await import('../../src/api/server');
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  it('GET /health always reports ok (liveness, no dependency checks)', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('GET /ready reports ok when Postgres and Temporal are reachable', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });
});
