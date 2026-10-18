import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { passCodes } from './gate/pass-codes.js';
import type { PortlAuth } from './auth/auth.js';
import type { PrismaClient } from './generated/prisma/client.js';

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

it('uses only the nearest forwarded client behind the configured single Render ingress hop', async () => {
  const handler = async (req: Request) =>
    Response.json({ ip: req.headers.get('x-portl-client-ip') });
  const services = {
    auth: {
      handler,
      acceptsOrigin: () => false,
    } as unknown as PortlAuth,
    db: {} as PrismaClient,
    baseURL: 'http://localhost:3000',
    passCodes: passCodes('proxy-test-only-secret-at-least-32-bytes'),
  };
  const response = await request(createApp(undefined, services, 1))
    .get('/api/auth/get-session')
    .set('x-forwarded-for', '198.51.100.7, 203.0.113.9')
    .set('x-portl-client-ip', '192.0.2.8');
  expect(response.status).toBe(200);
  expect(response.body.ip).toBe('203.0.113.9');
  const direct = await request(createApp(undefined, services))
    .get('/api/auth/get-session')
    .set('x-forwarded-for', '198.51.100.7')
    .set('x-portl-client-ip', '192.0.2.8');
  expect(direct.body.ip).toMatch(/127\.0\.0\.1|::1/);
});
