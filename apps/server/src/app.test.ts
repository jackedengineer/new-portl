import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { passCodes } from './gate/pass-codes.js';
import type { PortlAuth } from './auth/auth.js';
import type { PrismaClient } from './generated/prisma/client.js';

import { getIP } from '@better-auth/core/utils/ip';
import { CLIENT_IPV6_SUBNET } from './hosting/client-ip.js';
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

it('uses Render edge identity through multiple internal hops and ignores caller forwarding prefixes', async () => {
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
  const response = await request(createApp(undefined, services, 'render'))
    .get('/api/auth/get-session')
    .set('x-forwarded-for', '192.0.2.7, 198.51.100.7, 172.64.1.1, 10.0.0.9')
    .set('cf-connecting-ip', '198.51.100.7')
    .set('x-portl-client-ip', '192.0.2.8');
  expect(response.status).toBe(200);
  expect(response.body.ip).toBe('198.51.100.7');
  const direct = await request(createApp(undefined, services))
    .get('/api/auth/get-session')
    .set('x-forwarded-for', '198.51.100.7')
    .set('cf-connecting-ip', '198.51.100.7')
    .set('x-portl-client-ip', '192.0.2.8');
  expect(direct.body.ip).toMatch(/127\.0\.0\.1|::1/);
});

it('uses the same effective IPv6 and mapped IPv4 identity for auth and both deletion budgets', async () => {
  const subjects: string[] = [];
  const services = {
    auth: {
      handler: async (req: Request) =>
        Response.json({
          ip: getIP(req, {
            advanced: {
              ipAddress: {
                ipAddressHeaders: ['x-portl-client-ip'],
                ipv6Subnet: CLIENT_IPV6_SUBNET,
              },
            },
          }),
        }),
      acceptsOrigin: () => true,
      lifecycleRequest: async (
        _headers: Headers,
        work: () => Promise<unknown>,
      ) => work(),
      budget: async (subject: string) => {
        subjects.push(subject);
        return false;
      },
    } as unknown as PortlAuth,
    db: {} as PrismaClient,
    baseURL: 'http://localhost:3000',
    passCodes: passCodes('proxy-test-only-secret-at-least-32-bytes'),
  };
  const app = createApp(undefined, services, 'render');
  const identities: [string, string][] = [
    ['2001:db8:abcd:1234::1', '2001:0db8:abcd:1234:0000:0000:0000:0000'],
    ['2001:0DB8:ABCD:1234:0:0:0:2', '2001:0db8:abcd:1234:0000:0000:0000:0000'],
    ['::ffff:192.0.2.1', '192.0.2.1'],
    ['192.0.2.1', '192.0.2.1'],
    ['::ffff:c000:201', '192.0.2.1'],
  ];
  for (const [edgeIP, expected] of identities) {
    const response = await request(app)
      .get('/api/auth/get-session')
      .set('cf-connecting-ip', edgeIP)
      .set('x-portl-client-ip', '192.0.2.99');
    expect(response.body.ip).toBe(expected);
    const api = await request(app)
      .post('/v1/account/deletion/status')
      .set('origin', 'portl://')
      .set('cf-connecting-ip', edgeIP)
      .send({});
    expect(api.status).toBe(429);
    const web = await request(app)
      .post('/delete-account/status')
      .set('origin', 'http://localhost:3000')
      .set('cf-connecting-ip', edgeIP)
      .type('form')
      .send({});
    expect(web.status).toBe(429);
    expect(subjects.slice(-2)).toEqual([expected, expected]);
  }
});

it.each([
  undefined,
  '',
  'unknown',
  'fe80::1%eth0',
  '198.51.100.7, 203.0.113.9',
])(
  'uses one conservative budget for missing or invalid Render metadata %j',
  async (edgeIP) => {
    const services = {
      auth: {
        handler: async (req: Request) =>
          Response.json({ ip: req.headers.get('x-portl-client-ip') }),
        acceptsOrigin: () => false,
      } as unknown as PortlAuth,
      db: {} as PrismaClient,
      baseURL: 'http://localhost:3000',
      passCodes: passCodes('proxy-test-only-secret-at-least-32-bytes'),
    };
    const call = request(createApp(undefined, services, 'render'))
      .get('/api/auth/get-session')
      .set('x-forwarded-for', '198.51.100.7')
      .set('x-portl-client-ip', '192.0.2.8')
      .set('cf-connecting-ipv6', '2001:db8::1');
    if (edgeIP !== undefined) call.set('cf-connecting-ip', edgeIP);
    expect((await call).body.ip).toBe('127.0.0.1');
  },
);
