import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';

describe('API bootstrap', () => {
  it('serves uncached liveness without exposing the framework', async () => {
    const response = await request(createApp()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a stable JSON error for an unknown route', async () => {
    const response = await request(createApp()).get('/missing');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        requestId: expect.any(String),
      },
    });
    expect(response.body.error.requestId).toBe(
      response.headers['x-request-id'],
    );
  });

  it('generates request IDs instead of trusting client-provided identifiers', async () => {
    const response = await request(createApp())
      .get('/health/live')
      .set('x-request-id', 'untrusted-client-value');

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
