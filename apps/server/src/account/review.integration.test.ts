import { randomInt, randomUUID } from 'node:crypto';
import { POLICY_VERSION } from '@portl/contracts';
import { afterAll, expect, it, vi } from 'vitest';
import { createAuth } from '../auth/auth.js';
import { emailThrottleKey } from '../auth/throttle.js';
import { createDatabase } from '../database/client.js';
import { gateAdmin } from '../gate/admin.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { accountProof } from './proof.js';
import { accountService } from './service.js';

const databaseUrl = process.env.PORTL_TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error('An isolated integration database is required');
const owner = createDatabase(
  process.env.PORTL_TEST_DIRECT_DATABASE_URL ||
    process.env.DIRECT_DATABASE_URL!,
);
const db = createDatabase(databaseUrl);
const run = randomUUID();
const secret = `account-review-only-${run}`;
const proof = accountProof(secret);
const users: string[] = [];
const emails: string[] = [];
const societyId = randomUUID();
const gateId = randomUUID();
const clientIp = `198.18.${randomInt(1, 255)}.${randomInt(1, 255)}`;

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function user(label: string) {
  const id = randomUUID(),
    email = `${run}-${label}@account-review.invalid`;
  users.push(id);
  emails.push(email);
  await owner.user.create({
    data: { id, email, name: 'Review fixture', emailVerified: true },
  });
  return { id, email };
}

afterAll(async () => {
  await owner.registryAudit.deleteMany({ where: { societyId } });
  await owner.guardAssignment.deleteMany({ where: { societyId } });
  await owner.membership.deleteMany({ where: { societyId } });
  await owner.gate.deleteMany({ where: { societyId } });
  await owner.society.deleteMany({ where: { id: societyId } });
  await owner.accountDeletion.deleteMany({
    where: { subjectHash: { in: users.map(proof.subject) } },
  });
  await owner.user.deleteMany({ where: { id: { in: users } } });
  await owner.verification.deleteMany({
    where: {
      identifier: { in: emails.map((email) => `sign-in-otp-${email}`) },
    },
  });
  await owner.rateLimit.deleteMany({
    where: { key: { startsWith: `${clientIp}|` } },
  });
  await owner.otpThrottle.deleteMany({
    where: {
      key: {
        in: emails.flatMap((email) =>
          ['cooldown', 'hour'].map((bucket) =>
            emailThrottleKey(secret, email, bucket),
          ),
        ),
      },
    },
  });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

it('waits for deletion confirmation before rejecting an assignment to that target account', async () => {
  const administrator = await user('admin'),
    target = await user('guard');
  const sessionId = randomUUID();
  await owner.session.create({
    data: {
      id: sessionId,
      token: randomUUID(),
      userId: administrator.id,
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  await owner.adminAssurance.create({
    data: { sessionId, expiresAt: new Date(Date.now() + 600000) },
  });
  await owner.society.create({
    data: { id: societyId, name: 'Review race fixture', joinCodeHash: run },
  });
  await owner.gate.create({
    data: { id: gateId, societyId, name: 'Review gate' },
  });
  await owner.membership.createMany({
    data: [
      { societyId, userId: administrator.id, role: 'ADMIN' },
      { societyId, userId: target.id, role: 'GUARD' },
    ],
  });
  const locked = latch(),
    resume = latch();
  // Prisma query extensions also intercept calls on the interactive transaction.
  const delayed = db.$extends({
    query: {
      user: {
        async update({ args, query }) {
          const result = await query(args);
          if (args.where.id === target.id && args.data.deletionRequestedAt) {
            locked.release();
            await resume.promise;
          }
          return result;
        },
      },
    },
  }) as unknown as PrismaClient;
  let otp = '';
  const service = accountService(delayed, proof, async (message) => {
    otp = message.otp;
  });
  const challenge = await service.startDeletion(target.email);
  const confirmation = service.confirmDeletion({
    challengeId: challenge.challengeId,
    receiptToken: challenge.receiptToken,
    otp,
    confirmation: 'DELETE',
    expectedUserId: target.id,
  });
  const outcome = confirmation.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  let assignment: Promise<unknown> | undefined;
  try {
    await Promise.race([
      locked.promise,
      outcome.then(() => {
        throw new Error('Confirmation finished before the deletion barrier');
      }),
    ]);
    assignment = gateAdmin(db).assign(
      {
        userId: administrator.id,
        email: administrator.email,
        sessionId,
        requestId: randomUUID(),
      },
      societyId,
      { email: target.email, gateId },
    );
    // Attach rejection handling immediately while observing the actual database lock wait.
    const assigned = assignment.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.waitFor(
      async () => {
        const [row] = await owner.$queryRaw<
          { waiting: bigint }[]
        >`SELECT count(*) AS waiting FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%"deletionRequestedAt" IS NULL FOR SHARE%'`;
        expect(Number(row!.waiting)).toBeGreaterThan(0);
      },
      { timeout: 5000, interval: 25 },
    );
    resume.release();
    expect(await outcome).toMatchObject({ value: { status: 'PENDING' } });
    expect(await assigned).toMatchObject({
      error: { code: 'VERIFIED_ACCOUNT_REQUIRED' },
    });
    expect(
      await owner.guardAssignment.count({
        where: { societyId, userId: target.id },
      }),
    ).toBe(0);
    expect(
      await owner.registryAudit.count({
        where: { societyId, action: 'GUARD_ASSIGNED' },
      }),
    ).toBe(0);
  } finally {
    resume.release();
    await outcome;
    await assignment?.catch(() => undefined);
  }
});

it('rejects an old-email sign-in whose session is issued after the email change committed', async () => {
  const subject = await user('old-email');
  const nextEmail = `${run}-new-email@account-review.invalid`;
  emails.push(nextEmail);
  const reachedSession = latch(),
    resume = latch();
  let delaySession = false,
    issuedSessions = 0;
  const delayed = db.$extends({
    query: {
      session: {
        async create({ args, query }) {
          if (delaySession && args.data.userId === subject.id) {
            reachedSession.release();
            await resume.promise;
            issuedSessions++;
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
  let otp = '';
  const auth = createAuth(
    delayed,
    {
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: 'http://localhost:3000',
      TRUSTED_ORIGINS: ['portl://'],
      RESEND_API_KEY: 'unused-review-fixture',
      EMAIL_FROM: 'Review <review@example.com>',
    },
    async (message) => {
      otp = message.otp;
    },
  );
  const call = (path: string, body: object) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: 'POST',
        headers: {
          origin: 'portl://',
          'content-type': 'application/json',
          'x-portl-client-ip': clientIp,
        },
        body: JSON.stringify(body),
      }),
    );
  expect(
    (
      await call('/email-otp/send-verification-otp', {
        email: subject.email,
        type: 'sign-in',
      })
    ).status,
  ).toBe(200);
  delaySession = true;
  const login = call('/sign-in/email-otp', {
    email: subject.email,
    otp,
    policyAcceptance: {
      adult: true,
      termsVersion: POLICY_VERSION,
      privacyVersion: POLICY_VERSION,
    },
  });
  const outcome = login.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  try {
    await Promise.race([
      reachedSession.promise,
      outcome.then(() => {
        throw new Error('Sign-in finished before the session barrier');
      }),
    ]);
    // This executes the same database email-change trigger as the verified HTTP flow.
    await owner.user.update({
      where: { id: subject.id },
      data: { email: nextEmail },
    });
    resume.release();
    const result = await outcome;
    if (!('value' in result)) throw result.error;
    expect(issuedSessions).toBe(1);
    expect(result.value.status).toBe(401);
    expect(result.value.headers.getSetCookie()).toEqual([]);
    expect(await result.value.json()).not.toHaveProperty('token');
    expect(await owner.session.count({ where: { userId: subject.id } })).toBe(
      0,
    );
    expect(
      await owner.accountPolicy.findUnique({ where: { userId: subject.id } }),
    ).toBeNull();
  } finally {
    resume.release();
    await outcome;
  }
});
