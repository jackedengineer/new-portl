import { randomBytes, randomUUID } from 'node:crypto';
import { POLICY_VERSION } from '@portl/contracts';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '../database/client.js';
import { createAuth } from '../auth/auth.js';
import { createApp } from '../app.js';
import { passCodes } from '../gate/pass-codes.js';
import { scope, withActor } from '../registry/context.js';
import { reviewerKeyHash } from './proof.js';
import { reviewerService } from './service.js';

const runtime = process.env.PORTL_TEST_DATABASE_URL;
const direct =
  process.env.PORTL_TEST_DIRECT_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
if (!runtime || !direct) throw new Error('Isolated test URLs required');
const db = createDatabase(runtime),
  owner = createDatabase(direct);
const secret = 'reviewer-test-only-secret-at-least-32-characters';
const run = randomUUID(),
  societyId = randomUUID(),
  otherSocietyId = randomUUID();
const roles = ['RESIDENT', 'GUARD', 'ADMIN'] as const;
const identities = roles.map((role) => ({
  role,
  id: randomUUID(),
  email: `${run}-${role.toLowerCase()}@review.portl.invalid`,
  key: randomBytes(32).toString('base64url'),
}));
const normalId = randomUUID();
let sent = 0,
  ip = 0;
const auth = createAuth(
  db,
  {
    DATABASE_URL: runtime,
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: 'http://localhost:3000',
    TRUSTED_ORIGINS: ['portl://'],
    RESEND_API_KEY: 'unused',
    EMAIL_FROM: 'Test <test@example.com>',
  },
  async () => {
    sent++;
  },
);
const app = createApp(undefined, {
  auth,
  db,
  baseURL: 'http://localhost:3000',
  passCodes: passCodes(secret),
});
const acceptance = {
  adult: true,
  termsVersion: POLICY_VERSION,
  privacyVersion: POLICY_VERSION,
};
function call(
  path: string,
  body?: object,
  cookie?: string,
  expected?: string,
  origin = 'portl://',
) {
  return auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-portl-client-ip': `198.18.0.${++ip}`,
        ...(cookie ? { cookie } : {}),
        ...(expected ? { 'x-portl-expected-user': expected } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
async function signIn(index: number) {
  const identity = identities[index]!;
  const response = await call('/reviewer/sign-in', {
    role: identity.role,
    accessKey: identity.key,
    policyAcceptance: acceptance,
    reviewAcknowledged: true,
  });
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  expect(cookie).toContain('portl.session_token=');
  expect(await response.json()).toEqual({ success: true });
  const session = await owner.session.findFirstOrThrow({
    where: { userId: identity.id },
    orderBy: { createdAt: 'desc' },
  });
  return { ...identity, cookie, sessionId: session.id };
}
beforeAll(async () => {
  await owner.society.createMany({
    data: [
      {
        id: societyId,
        name: 'Fictional review test',
        joinCodeHash: randomUUID(),
        isDemo: true,
      },
      { id: otherSocietyId, name: 'Ordinary test', joinCodeHash: randomUUID() },
    ],
  });
  await owner.reviewRealm.create({ data: { societyId, enabled: true } });
  for (const identity of identities) {
    await owner.user.create({
      data: {
        id: identity.id,
        name: `Review ${identity.role}`,
        email: identity.email,
        emailVerified: true,
        isReviewer: true,
      },
    });
    await owner.reviewerAccount.create({
      data: {
        userId: identity.id,
        realmId: 'play-review',
        role: identity.role,
        keyHash: reviewerKeyHash(secret, identity.id, identity.key),
      },
    });
    await owner.membership.create({
      data: { societyId, userId: identity.id, role: identity.role },
    });
  }
  await owner.user.create({
    data: {
      id: normalId,
      email: `${run}@ordinary-test.invalid`,
      name: 'Normal',
      emailVerified: true,
    },
  });
});
afterAll(async () => {
  await owner.session.deleteMany({
    where: { userId: { in: [...identities.map((i) => i.id), normalId] } },
  });
  await owner.membership.deleteMany({
    where: { societyId: { in: [societyId, otherSocietyId] } },
  });
  await owner.reviewerAccount.deleteMany({
    where: { userId: { in: identities.map((i) => i.id) } },
  });
  await owner.reviewRealm.deleteMany({ where: { societyId } });
  await owner.society.deleteMany({
    where: { id: { in: [societyId, otherSocietyId] } },
  });
  await owner.user.deleteMany({
    where: { id: { in: [...identities.map((i) => i.id), normalId] } },
  });
  await owner.rateLimit.deleteMany({
    where: { key: { startsWith: '198.18.0.' } },
  });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

it.each([0, 1, 2])(
  'signs role %s into only the review society using a normal cookie',
  async (index) => {
    const signed = await signIn(index);
    const me = await request(app).get('/v1/me').set('cookie', signed.cookie);
    expect(me.status).toBe(200);
    expect(me.body.reviewer).toEqual({ societyId, role: signed.role });
    expect(
      me.body.memberships.map((m: { society: { id: string } }) => m.society.id),
    ).toEqual([societyId]);
    const actor = {
      userId: signed.id,
      email: signed.email,
      sessionId: signed.sessionId,
      requestId: run,
    };
    expect(
      await withActor(db, actor, async (tx) => {
        await scope(tx, otherSocietyId);
        return tx.society.findMany({ where: { id: otherSocietyId } });
      }),
    ).toEqual([]);
    expect(sent).toBe(0);
  },
);
it('rejects incorrect keys, absent acknowledgement, old policy and hostile origins without issuing sessions', async () => {
  const identity = identities[0]!;
  const body = {
    role: identity.role,
    accessKey: identity.key,
    policyAcceptance: acceptance,
    reviewAcknowledged: true,
  };
  for (const invalid of [
    { ...body, accessKey: randomBytes(32).toString('base64url') },
    { ...body, reviewAcknowledged: false },
    { ...body, policyAcceptance: { ...acceptance, privacyVersion: 'old' } },
  ]) {
    const response = await call('/reviewer/sign-in', invalid);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.getSetCookie()).toEqual([]);
  }
  expect(
    (
      await call(
        '/reviewer/sign-in',
        body,
        undefined,
        undefined,
        'https://hostile.invalid',
      )
    ).status,
  ).toBe(403);
});
it('denies ordinary OTP and personal lifecycle operations for shared identities', async () => {
  const signed = await signIn(0);
  expect(
    (
      await call('/email-otp/send-verification-otp', {
        email: signed.email,
        type: 'sign-in',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        '/email-otp/request-email-change',
        { newEmail: `${run}@example.com`, otp: '123456' },
        signed.cookie,
        signed.id,
      )
    ).status,
  ).toBe(403);
  await auth.accounts.startDeletion(signed.email);
  expect(sent).toBe(0);
  expect(
    await owner.deletionChallenge.count({ where: { userId: signed.id } }),
  ).toBe(0);
  expect(
    (
      await request(app)
        .get('/v1/account/recovery')
        .set('cookie', signed.cookie)
        .set('x-portl-expected-user', signed.id)
    ).status,
  ).toBe(403);
});
it('persists a bounded IP budget for reviewer key attempts', async () => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 11; attempt++) {
    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/reviewer/sign-in', {
        method: 'POST',
        headers: {
          origin: 'portl://',
          'content-type': 'application/json',
          'x-portl-client-ip': '198.18.0.250',
        },
        body: JSON.stringify({
          role: 'RESIDENT',
          accessKey: randomBytes(32).toString('base64url'),
          policyAcceptance: acceptance,
          reviewAcknowledged: true,
        }),
      }),
    );
    statuses.push(response.status);
  }
  expect(statuses).toEqual([...Array<number>(10).fill(401), 429]);
});
it('keeps admin step-up short lived and renews it only with that admin key', async () => {
  const signed = await signIn(2);
  await owner.adminAssurance.update({
    where: { sessionId: signed.sessionId },
    data: { expiresAt: new Date(0) },
  });
  expect(
    (
      await call(
        '/reviewer/reauthenticate',
        { accessKey: identities[0]!.key },
        signed.cookie,
        signed.id,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await call(
        '/reviewer/reauthenticate',
        { accessKey: signed.key },
        signed.cookie,
        signed.id,
      )
    ).status,
  ).toBe(200);
  const assurance = await owner.adminAssurance.findUniqueOrThrow({
    where: { sessionId: signed.sessionId },
  });
  expect(assurance.expiresAt.getTime() - Date.now()).toBeGreaterThan(800_000);
});
it('enforces exclusive roles and rejects cross-realm grants even for privileged writes', async () => {
  await expect(
    owner.membership.create({
      data: {
        societyId: otherSocietyId,
        userId: identities[0]!.id,
        role: 'RESIDENT',
      },
    }),
  ).rejects.toThrow();
  await expect(
    owner.membership.create({
      data: { societyId, userId: normalId, role: 'RESIDENT' },
    }),
  ).rejects.toThrow();
  await expect(
    owner.membership.create({
      data: { societyId, userId: identities[0]!.id, role: 'ADMIN' },
    }),
  ).rejects.toThrow();
  await expect(
    db.user.update({
      where: { id: identities[0]!.id },
      data: { isReviewer: false },
    }),
  ).rejects.toThrow();
  await expect(
    db.reviewRealm.update({
      where: { id: 'play-review' },
      data: { enabled: false },
    }),
  ).rejects.toThrow();
});
it('rejects issuance from a credential prepared before rotation, and invalidates existing cookies', async () => {
  const signed = await signIn(1),
    service = reviewerService(db, secret);
  const prepared = await service.credential(signed.role, signed.key);
  const account = await owner.reviewerAccount.findUniqueOrThrow({
    where: { userId: signed.id },
  });
  await owner.reviewerAccount.update({
    where: { userId: signed.id },
    data: {
      generation: account.generation + 1,
      keyHash: reviewerKeyHash(
        secret,
        signed.id,
        randomBytes(32).toString('base64url'),
      ),
    },
  });
  const late = await owner.session.create({
    data: {
      id: randomUUID(),
      token: randomUUID(),
      userId: signed.id,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await expect(service.finishSignIn(prepared, late.id)).rejects.toMatchObject({
    code: 'REVIEW_ACCESS_UNAVAILABLE',
  });
  expect(
    (await request(app).get('/v1/me').set('cookie', signed.cookie)).status,
  ).toBe(401);
  expect(
    await (await call('/get-session', undefined, signed.cookie)).json(),
  ).toBeNull();
  expect(
    await owner.reviewerSession.findUnique({ where: { sessionId: late.id } }),
  ).toBeNull();
});
