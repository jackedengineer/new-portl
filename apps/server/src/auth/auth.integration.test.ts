import { passCodes } from '../gate/pass-codes.js';
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { assertRestrictedRuntime, createDatabase } from '../database/client.js';
import { createAuth } from './auth.js';
import { emailThrottleKey } from './throttle.js';

const databaseUrl = process.env.PORTL_TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    'PORTL_TEST_DATABASE_URL is required; use an isolated development/test database',
  );
const db = createDatabase(databaseUrl);
const run = randomUUID();
const emails: string[] = [];
const sent = new Map<string, string>();
let failDelivery = false;
let failAfterVerificationAttempt = false;
const auth = createAuth(
  db,
  {
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: 'portl-test-only-secret-with-at-least-32-characters',
    BETTER_AUTH_URL: 'http://localhost:3000',
    TRUSTED_ORIGINS: ['portl://', 'exp://192.168.0.100:8081'],
    RESEND_API_KEY: 'unused-fake-boundary',
    EMAIL_FROM: 'Portl <auth@example.com>',
  },
  async ({ email, otp }) => {
    if (failAfterVerificationAttempt) {
      await call('/sign-in/email-otp', {
        email,
        otp: otp === '000000' ? '111111' : '000000',
      });
      throw new Error('provider-private-diagnostic');
    }
    if (failDelivery) throw new Error('provider-private-diagnostic');
    sent.set(email, otp);
  },
);

function identity() {
  const email = `${run}-${emails.length}@portl-test.invalid`;
  emails.push(email);
  return email;
}

let ip = 0;
async function call(
  path: string,
  body?: Record<string, unknown>,
  cookie?: string,
  expectedUserId?: string,
) {
  const response = await auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        origin: 'portl://',
        'content-type': 'application/json',
        'x-portl-client-ip': `203.0.113.${++ip}`,
        ...(cookie ? { cookie } : {}),
        ...(expectedUserId ? { 'x-portl-expected-user': expectedUserId } : {}),
      },
      ...(body
        ? {
            body: JSON.stringify({
              ...body,
              policyAcceptance: {
                adult: true,
                termsVersion: '2026-10-18',
                privacyVersion: '2026-10-18',
              },
            }),
          }
        : {}),
    }),
  );
  return response;
}

async function issue(email: string) {
  const response = await call('/email-otp/send-verification-otp', {
    email,
    type: 'sign-in',
  });
  expect(response.status).toBe(200);
  const otp = sent.get(email);
  expect(otp).toMatch(/^\d{6}$/);
  return otp!;
}

beforeAll(async () => {
  await assertRestrictedRuntime(db);
});
beforeEach(async () => {
  // Express fixtures share a loopback IP; each test needs its own send budget.
  await db.rateLimit.deleteMany({
    where: {
      key: {
        in: [
          '127.0.0.1|/email-otp/send-verification-otp',
          '::1|/email-otp/send-verification-otp',
        ],
      },
    },
  });
});
afterAll(async () => {
  // Only synthetic records created by this run; never truncate shared tables.
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.verification.deleteMany({
    where: {
      identifier: { in: emails.map((email) => `sign-in-otp-${email}`) },
    },
  });
  await db.rateLimit.deleteMany({
    where: { key: { startsWith: '203.0.113.' } },
  });
  await db.rateLimit.deleteMany({
    where: {
      key: {
        in: [
          '127.0.0.1|/email-otp/send-verification-otp',
          '::1|/email-otp/send-verification-otp',
        ],
      },
    },
  });
  await db.otpThrottle.deleteMany({
    where: {
      key: {
        in: emails.flatMap((email) =>
          ['cooldown', 'hour'].map((bucket) =>
            emailThrottleKey(
              'portl-test-only-secret-with-at-least-32-characters',
              email,
              bucket,
            ),
          ),
        ),
      },
    },
  });
  await db.$disconnect();
});

describe('email OTP with PostgreSQL', () => {
  it('uses a runtime role without schema ownership or migration-history access', async () => {
    const [row] = await db.$queryRaw<
      { canCreate: boolean; canReadMigrations: boolean }[]
    >`
      SELECT has_schema_privilege(current_user, 'portl_auth', 'CREATE') AS "canCreate",
        has_table_privilege(current_user, 'portl_auth._prisma_migrations', 'SELECT') AS "canReadMigrations"
    `;
    expect(row).toEqual({ canCreate: false, canReadMigrations: false });
  });

  it('stores a keyed digest and creates a verified identity without any role', async () => {
    const email = identity();
    const otp = await issue(email);
    const challenge = await db.verification.findUniqueOrThrow({
      where: { identifier: `sign-in-otp-${email}` },
    });
    expect(challenge.value).not.toContain(otp);
    const response = await call('/sign-in/email-otp', { email, otp });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.emailVerified).toBe(true);
    expect(body.user).not.toHaveProperty('role');
    const replay = await call('/sign-in/email-otp', { email, otp });
    expect(replay.status).toBe(400);
  });

  it('allows only one successful concurrent use of a code', async () => {
    const email = identity();
    const otp = await issue(email);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        call('/sign-in/email-otp', { email, otp }),
      ),
    );
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it('rejects expired codes and exhausts a code after three wrong attempts', async () => {
    const expiredEmail = identity();
    const expiredOtp = await issue(expiredEmail);
    await db.verification.update({
      where: { identifier: `sign-in-otp-${expiredEmail}` },
      data: { expiresAt: new Date(0) },
    });
    expect(
      (
        await call('/sign-in/email-otp', {
          email: expiredEmail,
          otp: expiredOtp,
        })
      ).status,
    ).toBe(400);
    const email = identity();
    const otp = await issue(email);
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(
        (await call('/sign-in/email-otp', { email, otp: wrong })).status,
      ).toBe(400);
    }
    expect((await call('/sign-in/email-otp', { email, otp })).status).toBe(403);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  it('blocks concurrent sends to one email, even from different IPs', async () => {
    const email = identity();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        call('/email-otp/send-verification-otp', { email, type: 'sign-in' }),
      ),
    );
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(5);
  });

  it('removes a failed delivery challenge and hides provider details', async () => {
    const email = identity();
    failDelivery = true;
    try {
      const response = await call('/email-otp/send-verification-otp', {
        email,
        type: 'sign-in',
      });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(
        'provider-private-diagnostic',
      );
      expect(
        await db.verification.findUnique({
          where: { identifier: `sign-in-otp-${email}` },
        }),
      ).toBeNull();
    } finally {
      failDelivery = false;
    }
  });

  it('rejects password routes and non-login OTP purposes', async () => {
    expect(
      (
        await call('/sign-in/email', {
          email: identity(),
          password: 'irrelevant',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call('/email-otp/send-verification-otp', {
          email: identity(),
          type: 'forget-password',
        })
      ).status,
    ).toBe(400);
  });

  it('invalidates a failed delivery even if a wrong-code attempt changed its counter', async () => {
    const email = identity();
    failAfterVerificationAttempt = true;
    try {
      const response = await call('/email-otp/send-verification-otp', {
        email,
        type: 'sign-in',
      });
      expect(response.status).toBe(503);
      expect(
        Boolean(
          await db.verification.findUnique({
            where: { identifier: `sign-in-otp-${email}` },
          }),
        ),
      ).toBe(false);
    } finally {
      failAfterVerificationAttempt = false;
    }
  });

  it('enforces the hourly email budget after the cooldown has elapsed', async () => {
    const email = identity();
    await issue(email);
    await db.otpThrottle.update({
      where: {
        key: emailThrottleKey(
          'portl-test-only-secret-with-at-least-32-characters',
          email,
          'cooldown',
        ),
      },
      data: { resetAt: new Date(0) },
    });
    await db.otpThrottle.update({
      where: {
        key: emailThrottleKey(
          'portl-test-only-secret-with-at-least-32-characters',
          email,
          'hour',
        ),
      },
      data: { count: 5 },
    });
    expect(
      (
        await call('/email-otp/send-verification-otp', {
          email,
          type: 'sign-in',
        })
      ).status,
    ).toBe(429);
  });

  it.each(['portl://', 'exp://192.168.0.100:8081'])(
    'forwards native sign-in cookies for %s and authenticates the next request',
    async (origin) => {
      const app = createApp(undefined, {
        auth,
        db,
        baseURL: 'http://localhost:3000',
        passCodes: passCodes('test-only-guest-pass-secret-at-least-32-bytes'),
      });
      const email = identity();
      const issued = await request(app)
        .post('/api/auth/email-otp/send-verification-otp')
        .set('expo-origin', origin)
        .send({ email, type: 'sign-in' });
      expect(issued.status).toBe(200);
      const signedIn = await request(app)
        .post('/api/auth/sign-in/email-otp')
        .set('expo-origin', origin)
        .send({
          email,
          otp: sent.get(email),
          policyAcceptance: {
            adult: true,
            termsVersion: '2026-10-18',
            privacyVersion: '2026-10-18',
          },
        });
      expect(signedIn.status).toBe(200);
      const cookies = signedIn.headers['set-cookie'] as unknown as string[];
      expect(
        cookies.some(
          (cookie) =>
            cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax'),
        ),
      ).toBe(true);
      const profile = await request(app)
        .get('/v1/me')
        .set(
          'cookie',
          cookies.map((cookie) => cookie.split(';')[0]).join('; '),
        );
      expect(profile.status).toBe(200);
      expect(profile.body.user.email).toBe(email);
    },
  );

  it('rejects an Expo Go host absent from the exact allowlist', async () => {
    const app = createApp(undefined, {
      auth,
      db,
      baseURL: 'http://localhost:3000',
      passCodes: passCodes('test-only-guest-pass-secret-at-least-32-bytes'),
    });
    const email = identity();
    const response = await request(app)
      .post('/api/auth/email-otp/send-verification-otp')
      .set('expo-origin', 'exp://192.168.0.101:8081')
      .send({ email, type: 'sign-in' });
    expect(response.status).toBe(403);
    expect(sent.has(email)).toBe(false);
  });

  it('rejects untrusted origins, malformed JSON and oversized bodies at the Express boundary', async () => {
    const app = createApp(undefined, {
      auth,
      db,
      baseURL: 'http://localhost:3000',
      passCodes: passCodes('test-only-guest-pass-secret-at-least-32-bytes'),
    });
    const path = '/api/auth/email-otp/send-verification-otp';
    const hostile = await request(app)
      .post(path)
      .set('origin', 'https://evil.example')
      .send({ email: identity(), type: 'sign-in' });
    expect(hostile.status).toBe(403);
    expect(
      (
        await request(app)
          .post(path)
          .set('content-type', 'application/json')
          .send('{')
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(path)
          .send({ email: 'x'.repeat(9000) })
      ).status,
    ).toBe(413);
  });

  it('prevents clients from evading the IP send limit with forged forwarding headers', async () => {
    const app = createApp(undefined, {
      auth,
      db,
      baseURL: 'http://localhost:3000',
      passCodes: passCodes('test-only-guest-pass-secret-at-least-32-bytes'),
    });
    // Remove only the loopback bucket this local HTTP fixture owns.
    await db.rateLimit.deleteMany({
      where: {
        key: {
          in: [
            '127.0.0.1|/email-otp/send-verification-otp',
            '::1|/email-otp/send-verification-otp',
          ],
        },
      },
    });
    const responses = [];
    for (let index = 0; index < 4; index++) {
      responses.push(
        await request(app)
          .post('/api/auth/email-otp/send-verification-otp')
          .set('origin', 'portl://')
          .set('x-portl-client-ip', `198.51.100.${index + 1}`)
          .set('x-forwarded-for', `198.51.100.${index + 1}`)
          .send({ email: identity(), type: 'sign-in' }),
      );
    }
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 429,
    ]);
  });

  it('serves the protected identity projection and revokes its session on logout', async () => {
    const email = identity();
    const otp = await issue(email);
    const response = await call('/sign-in/email-otp', { email, otp });
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const app = createApp(undefined, {
      auth,
      db,
      baseURL: 'http://localhost:3000',
      passCodes: passCodes('test-only-guest-pass-secret-at-least-32-bytes'),
    });
    expect((await request(app).get('/v1/me')).status).toBe(401);
    const profile = await request(app).get('/v1/me').set('cookie', cookie);
    expect(profile.status).toBe(200);
    expect(profile.body.onboardingRequired).toBe(true);
    expect(profile.body.memberships).toEqual([]);
    expect(profile.body).not.toHaveProperty('session');
    expect((await call('/sign-out', {}, cookie)).status).toBe(200);
    expect(
      (await request(app).get('/v1/me').set('cookie', cookie)).status,
    ).toBe(401);
  });
});

it('verifies both mailboxes before changing email, preserves identity and revokes all sessions', async () => {
  const oldEmail = identity(),
    newEmail = identity();
  const signed = await call('/sign-in/email-otp', {
    email: oldEmail,
    otp: await issue(oldEmail),
  });
  const cookie = signed.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const user = await db.user.findUniqueOrThrow({ where: { email: oldEmail } });
  expect(
    (
      await call(
        '/email-otp/request-email-change',
        { newEmail, otp: '000000' },
        cookie,
        user.id,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        '/email-otp/send-verification-otp',
        { email: oldEmail, type: 'email-verification' },
        cookie,
        'wrong-user',
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        '/email-otp/send-verification-otp',
        { email: oldEmail, type: 'email-verification' },
        cookie,
        user.id,
      )
    ).status,
  ).toBe(200);
  const currentCode = sent.get(oldEmail)!;
  // The failed request consumed the recipient cooldown; advance only this test's bucket.
  await db.otpThrottle.update({
    where: {
      key: emailThrottleKey(
        'portl-test-only-secret-with-at-least-32-characters',
        newEmail,
        'cooldown',
      ),
    },
    data: { resetAt: new Date(0) },
  });
  expect(
    (
      await call(
        '/email-otp/request-email-change',
        { newEmail, otp: currentCode },
        cookie,
        user.id,
      )
    ).status,
  ).toBe(200);
  expect(await db.user.findUnique({ where: { email: newEmail } })).toBeNull();
  const nextCode = sent.get(newEmail)!;
  expect(nextCode).toMatch(/^\d{6}$/);
  expect(
    (
      await call(
        '/email-otp/change-email',
        { newEmail, otp: nextCode },
        cookie,
        user.id,
      )
    ).status,
  ).toBe(200);
  expect(
    (await db.user.findUniqueOrThrow({ where: { email: newEmail } })).id,
  ).toBe(user.id);
  expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  expect(
    await auth.accountSession({ headers: new Headers({ cookie }) }),
  ).toBeNull();
  expect(
    (
      await call(
        '/email-otp/change-email',
        { newEmail, otp: nextCode },
        cookie,
        user.id,
      )
    ).status,
  ).toBe(401);
});
it('requires explicit current policy and adult attestation before creating an account', async () => {
  const email = identity(),
    otp = await issue(email);
  for (const policyAcceptance of [
    undefined,
    { adult: false, termsVersion: '2026-10-18', privacyVersion: '2026-10-18' },
    { adult: true, termsVersion: 'old', privacyVersion: 'old' },
  ]) {
    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/email-otp', {
        method: 'POST',
        headers: {
          origin: 'portl://',
          'content-type': 'application/json',
          'x-portl-client-ip': `203.0.113.${++ip}`,
        },
        body: JSON.stringify({ email, otp, policyAcceptance }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  }
  expect((await call('/sign-in/email-otp', { email, otp })).status).toBe(200);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(
    await db.accountPolicy.findUnique({ where: { userId: user.id } }),
  ).toMatchObject({ version: '2026-10-18', adult: true });
});
