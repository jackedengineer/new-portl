import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortlAuth } from '../auth/auth.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { gateRouter } from '../gate/router.js';
import type { PassCodes } from '../gate/pass-codes.js';
import { DomainError } from './context.js';
import { registryRouter } from './router.js';

const business = vi.hoisted(() => ({
  applications: vi.fn(),
  accept: vi.fn(),
  setup: vi.fn(),
  decision: vi.fn(),
  passList: vi.fn(),
  passCreate: vi.fn(),
}));
vi.mock('./service.js', () => ({
  registryService: () => ({
    applications: business.applications,
    accept: business.accept,
  }),
}));
vi.mock('../gate/queries.js', () => ({
  gateQueries: () => ({ setup: business.setup }),
}));
vi.mock('../gate/commands.js', () => ({
  gateCommands: () => ({ act: business.decision }),
}));
vi.mock('../gate/admin.js', () => ({ gateAdmin: () => ({}) }));
vi.mock('../gate/pass-queries.js', () => ({
  passQueries: () => ({ list: business.passList }),
}));
vi.mock('../gate/pass-commands.js', () => ({
  passCommands: () => ({ create: business.passCreate }),
}));

const currentUser = 'user-b';
const currentActor = {
  userId: currentUser,
  email: 'b@example.test',
  sessionId: 'session-b',
  requestId: 'identity-test',
};
const cases = [
  {
    name: 'application history read',
    method: 'get',
    path: '/v1/onboarding/applications',
    operation: business.applications,
    status: 200,
  },
  {
    name: 'invitation acceptance',
    method: 'post',
    path: '/v1/onboarding/invitation-accept',
    body: { token: 'A'.repeat(43) },
    operation: business.accept,
    status: 200,
  },
  {
    name: 'gate setup read',
    method: 'get',
    path: '/v1/societies/society-1/gate/setup?view=GUARD',
    operation: business.setup,
    status: 200,
  },
  {
    name: 'visitor approval',
    method: 'post',
    path: '/v1/societies/society-1/gate/requests/visitor-1/decision',
    body: {
      intentId: 'a47bcf0d-d40f-4c85-8fc9-ef4f4f514233',
      expectedVersion: 1,
      decision: 'APPROVE',
    },
    operation: business.decision,
    status: 200,
  },
  {
    name: 'guest pass history read',
    method: 'get',
    path: '/v1/societies/society-1/gate/passes?view=RESIDENT&filter=HISTORY',
    operation: business.passList,
    status: 200,
  },
  {
    name: 'guest pass creation',
    method: 'post',
    path: '/v1/societies/society-1/gate/passes',
    body: {
      intentId: 'a47bcf0d-d40f-4c85-8fc9-ef4f4f514233',
      flatId: 'flat-1',
      visitorName: 'Expected guest',
      validFrom: '2026-10-18T04:30:00.000Z',
      validUntil: '2026-10-18T05:30:00.000Z',
    },
    operation: business.passCreate,
    status: 201,
  },
] as const;

function app() {
  const auth = {
    lifecycle: { identity: async () => null },
    api: {
      getSession: async () => ({
        user: {
          id: currentUser,
          email: currentActor.email,
          emailVerified: true,
        },
        session: { id: currentActor.sessionId },
      }),
    },
    acceptsOrigin: (origin: string) => origin === 'portl://',
    budget: async () => true,
  } as unknown as PortlAuth;
  const db = {} as PrismaClient;
  const server = express();
  server.use((_req, res, next) => {
    res.setHeader('x-request-id', currentActor.requestId);
    next();
  });
  server.use(
    '/v1/societies/:societyId/gate',
    gateRouter(auth, db, {} as PassCodes),
  );
  server.use('/v1', registryRouter(auth, db));
  server.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (error instanceof DomainError)
        res.status(error.status).json({ error: { code: error.code } });
      else next(error);
    },
  );
  return server;
}

function call(testCase: (typeof cases)[number], expectedUser?: string) {
  const client = request(app());
  const pending = client[testCase.method](testCase.path).set(
    'expo-origin',
    'portl://',
  );
  if (expectedUser !== undefined)
    pending.set('x-portl-expected-user', expectedUser);
  if ('body' in testCase) pending.send(testCase.body);
  return pending;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const operation of Object.values(business))
    operation.mockResolvedValue({ performedAs: currentUser });
});

describe('registry and gate identity boundaries', () => {
  it.each(cases)('rejects stale identity before $name', async (testCase) => {
    const response = await call(testCase, 'user-a');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: 'SESSION_CHANGED' } });
    for (const operation of Object.values(business))
      expect(operation).not.toHaveBeenCalled();
  });

  it.each(cases)('allows matching identity for $name', async (testCase) => {
    const response = await call(testCase, currentUser);

    expect(response.status).toBe(testCase.status);
    expect(response.body).toEqual({ performedAs: currentUser });
    expect(testCase.operation).toHaveBeenCalledOnce();
    expect(testCase.operation.mock.calls[0]?.[0]).toEqual(currentActor);
  });

  it.each(cases)(
    'preserves legacy requests without a header for $name',
    async (testCase) => {
      const response = await call(testCase);

      expect(response.status).toBe(testCase.status);
      expect(response.body).toEqual({ performedAs: currentUser });
      expect(testCase.operation).toHaveBeenCalledOnce();
      expect(testCase.operation.mock.calls[0]?.[0]).toEqual(currentActor);
    },
  );
});
