import { randomBytes, randomUUID } from 'node:crypto';
import { POLICY_VERSION } from '@portl/contracts';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createDatabase } from '../database/client.js';
import { createAuth } from '../auth/auth.js';
import { createApp } from '../app.js';
import { passCodes } from '../gate/pass-codes.js';
import { gateLiveAccess } from '../gate/live-access.js';
import { gateAdmin } from '../gate/admin.js';
import { registryService } from '../registry/service.js';
import { hash, scope, withActor } from '../registry/context.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  createReviewRealm,
  rotateReviewKey,
  setReviewRealmEnabled,
} from './operator.js';

const runtime = process.env.PORTL_TEST_DATABASE_URL,
  direct =
    process.env.PORTL_TEST_DIRECT_DATABASE_URL ||
    process.env.DIRECT_DATABASE_URL;
if (!runtime || !direct) throw new Error('Isolated test URLs required');
const db = createDatabase(runtime),
  owner = createDatabase(direct);
const secret = 'review-operator-test-secret-at-least-32-characters';
let fixture: Awaited<ReturnType<typeof createReviewRealm>>,
  ip = 0;
const normalId = randomUUID(),
  ordinarySociety = randomUUID(),
  ordinaryFlat = randomUUID(),
  normalSession = randomUUID();
const ordinaryEmail = `${randomUUID()}@review-operator-test.invalid`;
const normalActor = {
  userId: normalId,
  email: ordinaryEmail,
  sessionId: normalSession,
  requestId: randomUUID(),
};
function makeAuth(client = db) {
  return createAuth(
    client,
    {
      DATABASE_URL: runtime!,
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: 'http://localhost:3000',
      TRUSTED_ORIGINS: ['portl://'],
      RESEND_API_KEY: 'unused',
      EMAIL_FROM: 'Test <test@example.com>',
    },
    async () => {
      throw new Error('Review flows must not send email');
    },
  );
}
const auth = makeAuth();
const app = createApp(undefined, {
  auth,
  db,
  baseURL: 'http://localhost:3000',
  passCodes: passCodes(secret),
});
function call(client: typeof auth, role: string, key: string) {
  return client.handler(
    new Request('http://localhost:3000/api/auth/reviewer/sign-in', {
      method: 'POST',
      headers: {
        origin: 'portl://',
        'content-type': 'application/json',
        'x-portl-client-ip': `198.19.0.${++ip}`,
      },
      body: JSON.stringify({
        role,
        accessKey: key,
        reviewAcknowledged: true,
        policyAcceptance: {
          adult: true,
          termsVersion: POLICY_VERSION,
          privacyVersion: POLICY_VERSION,
        },
      }),
    }),
  );
}
async function login(role: 'RESIDENT' | 'GUARD' | 'ADMIN') {
  const account = fixture.credentials.find((c) => c.role === role)!;
  const response = await call(auth, role, account.accessKey);
  expect(response.status).toBe(200);
  const session = await owner.session.findFirstOrThrow({
    where: { userId: account.userId },
    orderBy: { createdAt: 'desc' },
  });
  return {
    ...account,
    sessionId: session.id,
    requestId: randomUUID(),
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  };
}
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
beforeAll(async () => {
  fixture = await createReviewRealm(owner, secret);
  await setReviewRealmEnabled(owner, true);
  await owner.society.create({
    data: {
      id: ordinarySociety,
      name: 'Ordinary isolation fixture',
      joinCodeHash: hash('ORDINARY1234'),
    },
  });
  const tower = await owner.tower.create({
    data: { societyId: ordinarySociety, name: 'A' },
  });
  await owner.flat.create({
    data: {
      id: ordinaryFlat,
      societyId: ordinarySociety,
      towerId: tower.id,
      label: '101',
    },
  });
  await owner.user.create({
    data: {
      id: normalId,
      email: ordinaryEmail,
      name: 'Ordinary',
      emailVerified: true,
    },
  });
  await owner.session.create({
    data: {
      id: normalSession,
      userId: normalId,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  await owner.membership.create({
    data: { societyId: ordinarySociety, userId: normalId, role: 'RESIDENT' },
  });
  await owner.accountPolicy.create({
    data: { userId: normalId, version: POLICY_VERSION, adult: true },
  });
});
afterAll(async () => {
  if (fixture) {
    const societies = [fixture.societyId, ordinarySociety],
      users = [normalId, ...fixture.credentials.map((c) => c.userId)];
    await owner.session.deleteMany({ where: { userId: { in: users } } });
    await owner.notice.deleteMany({ where: { societyId: { in: societies } } });
    await owner.directoryEntry.deleteMany({
      where: { societyId: { in: societies } },
    });
    await owner.guardAssignment.deleteMany({
      where: { societyId: { in: societies } },
    });
    await owner.gate.deleteMany({ where: { societyId: { in: societies } } });
    await owner.occupancy.deleteMany({
      where: { societyId: { in: societies } },
    });
    await owner.membership.deleteMany({
      where: { societyId: { in: societies } },
    });
    await owner.flat.deleteMany({ where: { societyId: { in: societies } } });
    await owner.tower.deleteMany({ where: { societyId: { in: societies } } });
    await owner.reviewerAccount.deleteMany({
      where: { userId: { in: users } },
    });
    await owner.reviewRealm.deleteMany({
      where: { societyId: fixture.societyId },
    });
    await owner.society.deleteMany({ where: { id: { in: societies } } });
    await owner.user.deleteMany({ where: { id: { in: users } } });
  }
  await owner.rateLimit.deleteMany({
    where: { key: { startsWith: '198.19.0.' } },
  });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});
it('provisions only fictional fixtures without pre-accepting a human policy, and refuses repeat/runtime provisioning', async () => {
  expect(
    await owner.tower.count({ where: { societyId: fixture.societyId } }),
  ).toBe(2);
  expect(
    await owner.flat.count({ where: { societyId: fixture.societyId } }),
  ).toBe(4);
  expect(
    await owner.accountPolicy.count({
      where: { userId: { in: fixture.credentials.map((c) => c.userId) } },
    }),
  ).toBe(0);
  await expect(createReviewRealm(owner, secret)).rejects.toThrow();
  await expect(createReviewRealm(db, secret)).rejects.toThrow(
    'migration owner',
  );
});
it('fences reads, mutations and public admission in both directions and hides real-account existence', async () => {
  const resident = await login('RESIDENT'),
    admin = await login('ADMIN');
  await owner.society.update({
    where: { id: fixture.societyId },
    data: { joinCodeHash: hash('REVIEW1234567') },
  });
  await expect(
    registryService(db).lookup(resident, 'ORDINARY1234'),
  ).rejects.toMatchObject({ code: 'SOCIETY_NOT_FOUND' });
  await expect(
    registryService(db).lookup(normalActor, 'REVIEW1234567'),
  ).rejects.toMatchObject({ code: 'SOCIETY_NOT_FOUND' });
  expect(
    await withActor(db, normalActor, async (tx) => {
      await scope(tx, fixture.societyId);
      return tx.society.findMany({ where: { id: fixture.societyId } });
    }),
  ).toEqual([]);
  await expect(
    withActor(db, resident, async (tx) => {
      await scope(tx, ordinarySociety);
      return tx.residentApplication.create({
        data: {
          societyId: ordinarySociety,
          flatId: ordinaryFlat,
          userId: resident.userId,
          name: 'Fictional',
          relationship: 'TENANT',
        },
      });
    }),
  ).rejects.toThrow();
  const gate = await owner.gate.findFirstOrThrow({
    where: { societyId: fixture.societyId },
  });
  for (const email of [ordinaryEmail, `${randomUUID()}@unknown.invalid`])
    await expect(
      gateAdmin(db).assign(admin, fixture.societyId, {
        email,
        gateId: gate.id,
      }),
    ).rejects.toMatchObject({ code: 'TARGET_UNAVAILABLE' });
});
it('fails closed for a missing session marker and disables existing socket authorization', async () => {
  const guard = await login('GUARD');
  const access = gateLiveAccess(auth, db),
    subscription = {
      userId: guard.userId,
      societyId: fixture.societyId,
      view: 'GUARD' as const,
    };
  expect(await access({ cookie: guard.cookie }, subscription)).toBe(true);
  await owner.reviewerSession.delete({ where: { sessionId: guard.sessionId } });
  await expect(
    access({ cookie: guard.cookie }, subscription),
  ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect(
    (await request(app).get('/v1/me').set('cookie', guard.cookie)).status,
  ).toBe(401);
});
it('rejects an in-flight old-key sign-in whose session is created after operator rotation', async () => {
  const account = fixture.credentials.find((c) => c.role === 'RESIDENT')!,
    reached = latch(),
    resume = latch();
  const delayed = db.$extends({
    query: {
      session: {
        async create({ args, query }) {
          if (args.data.userId === account.userId) {
            reached.release();
            await resume.promise;
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
  const pending = call(makeAuth(delayed), account.role, account.accessKey);
  const outcome = pending.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  try {
    await Promise.race([
      reached.promise,
      outcome.then(() => {
        throw new Error('Session barrier not reached');
      }),
    ]);
    const rotated = await rotateReviewKey(owner, secret, account.role);
    account.accessKey = rotated.accessKey;
    resume.release();
    const result = await outcome;
    if (!('value' in result)) throw result.error;
    expect(result.value.status).toBe(401);
    expect(result.value.headers.getSetCookie()).toEqual([]);
    expect(
      await owner.session.count({ where: { userId: account.userId } }),
    ).toBe(0);
  } finally {
    resume.release();
    await outcome;
  }
});
it('serializes reauthentication with rotation and prevents stale assurance from returning', async () => {
  const admin = await login('ADMIN'),
    reached = latch(),
    resume = latch();
  const delayed = owner.$extends({
    query: {
      reviewerAccount: {
        async update({ args, query }) {
          const result = await query(args);
          reached.release();
          await resume.promise;
          return result;
        },
      },
    },
  }) as unknown as PrismaClient;
  const rotation = rotateReviewKey(delayed, secret, 'ADMIN');
  const rotated = rotation.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  let reauth: Promise<unknown> | undefined;
  try {
    await Promise.race([
      reached.promise,
      rotated.then(() => {
        throw new Error('Rotation barrier not reached');
      }),
    ]);
    const { reviewerService } = await import('./service.js');
    reauth = reviewerService(db, secret)
      .reauthenticate(admin.userId, admin.sessionId, admin.accessKey)
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await vi.waitFor(
      async () => {
        const [row] = await owner.$queryRaw<
          { waiting: bigint }[]
        >`SELECT count(*) AS waiting FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND a.usename=${decodeURIComponent(new URL(runtime!).username)} AND NOT l.granted AND l.locktype='transactionid'`;
        expect(Number(row!.waiting)).toBeGreaterThan(0);
      },
      { timeout: 5000, interval: 25 },
    );
    resume.release();
    const result = await rotated;
    if (!('value' in result)) throw result.error;
    fixture.credentials.find((c) => c.role === 'ADMIN')!.accessKey =
      result.value.accessKey;
    expect(await reauth).toMatchObject({
      error: { code: 'REVIEW_ACCESS_UNAVAILABLE' },
    });
    expect(
      await owner.adminAssurance.findUnique({
        where: { sessionId: admin.sessionId },
      }),
    ).toBeNull();
  } finally {
    resume.release();
    await rotated;
    await reauth;
  }
});
it('disables review sessions and push registrations without changing ordinary identities', async () => {
  const guard = await login('GUARD');
  await owner.pushDevice.create({
    data: {
      id: randomUUID(),
      userId: guard.userId,
      sessionId: guard.sessionId,
      generation: randomUUID(),
      platform: 'android',
      tokenHash: randomBytes(32).toString('hex'),
      cipherText: 'fictional-test',
    },
  });
  await setReviewRealmEnabled(owner, false);
  expect(
    (await request(app).get('/v1/me').set('cookie', guard.cookie)).status,
  ).toBe(401);
  expect(
    await owner.pushDevice.count({
      where: { userId: guard.userId, enabled: true },
    }),
  ).toBe(0);
  expect(
    (await owner.user.findUniqueOrThrow({ where: { id: guard.userId } }))
      .isReviewer,
  ).toBe(true);
  expect(await auth.reviewer.allowed(normalId, normalSession)).toBe(true);
  await owner.pushDevice.deleteMany({ where: { userId: guard.userId } });
});
