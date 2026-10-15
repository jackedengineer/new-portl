import { randomBytes, randomUUID } from 'node:crypto';
import { POLICY_VERSION } from '@portl/contracts';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '../database/client.js';
import { createAuth } from '../auth/auth.js';
import { createApp } from '../app.js';
import { passCodes } from '../gate/pass-codes.js';
import { scope, withActor } from '../registry/context.js';
import { reviewerKeyHash } from './proof.js';
import { accountProof } from '../account/proof.js';
import { reviewerService } from './service.js';

const runtime = process.env.PORTL_TEST_DATABASE_URL;
const direct =
  process.env.PORTL_TEST_DIRECT_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
if (!runtime || !direct) throw new Error('Isolated test URLs required');
const worker = createDatabase(process.env.WORKER_DATABASE_URL!);
const db = createDatabase(runtime),
  owner = createDatabase(direct);
const secret = `reviewer-test-only-secret-at-least-32-characters-${randomUUID()}`;
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
const sentCodes: string[] = [];
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
  async (message) => {
    sentCodes.push(message.otp);
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
afterEach(async () => {
  const children = await owner.reviewLifecycle.findMany({
    where: { parentId: { in: identities.map((i) => i.id) } },
  });
  for (const child of children) {
    await owner.verification.deleteMany({
      where: {
        identifier: {
          in: [
            `email-verification-otp-${child.originalEmail}`,
            `change-email-otp-${child.originalEmail}-${child.nextEmail}`,
          ],
        },
      },
    });
    await owner.accountDeletion.deleteMany({
      where: { subjectHash: accountProof(secret).subject(child.userId) },
    });
    await owner.user.deleteMany({ where: { id: child.userId } });
  }
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
  await Promise.all([
    db.$disconnect(),
    owner.$disconnect(),
    worker.$disconnect(),
  ]);
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
it('creates a disposable lifecycle identity without changing the shared reviewer', async () => {
  const parent = await signIn(0);
  const result = await call(
    '/reviewer/lifecycle',
    { purpose: 'email-change' },
    parent.cookie,
    parent.id,
  );
  expect(result.status).toBe(200);
  const cookie = result.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const me = await request(app).get('/v1/me').set('cookie', cookie);
  expect(me.status).toBe(200);
  expect(me.body.user.id).not.toBe(parent.id);
  expect(me.body.memberships).toEqual([]);
  expect(me.body.reviewLifecycle.purpose).toBe('email-change');
  expect(me.body.reviewLifecycle.nextEmail).toMatch(
    /@lifecycle.review.portl.invalid$/,
  );
  expect(
    await owner.user.findUnique({ where: { id: parent.id } }),
  ).toMatchObject({ email: parent.email, isReviewer: true });
});

async function disposable(purpose: 'email-change' | 'deletion', index = 0) {
  const parent = await signIn(index);
  const result = await call(
    '/reviewer/lifecycle',
    { purpose },
    parent.cookie,
    parent.id,
  );
  expect(result.status).toBe(200);
  const cookie = result.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const me = await request(app).get('/v1/me').set('cookie', cookie);
  expect(me.status).toBe(200);
  return {
    parent,
    cookie,
    id: String(me.body.user.id),
    email: String(me.body.user.email),
    nextEmail: String(me.body.reviewLifecycle.nextEmail),
  };
}
function privatePost(
  child: { cookie: string; id: string },
  path: string,
  body: object,
) {
  return request(app)
    .post(`/v1/account${path}`)
    .set('origin', 'portl://')
    .set('cookie', child.cookie)
    .set('x-portl-expected-user', child.id)
    .send(body);
}
it('performs real two-address email verification, persists the change and revokes every disposable session', async () => {
  const child = await disposable('email-change');
  expect(
    (
      await call(
        '/email-otp/send-verification-otp',
        { email: child.email, type: 'email-verification' },
        child.cookie,
        child.id,
      )
    ).status,
  ).toBe(200);
  const current = await privatePost(child, '/review-code', {
    purpose: 'verify-current-email',
  });
  expect(current.status).toBe(200);
  expect(current.body.otp).toMatch(/^\d{6}$/);
  expect(
    (
      await call(
        '/email-otp/request-email-change',
        { newEmail: 'real@example.com', otp: current.body.otp },
        child.cookie,
        child.id,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        '/email-otp/request-email-change',
        { newEmail: child.nextEmail, otp: current.body.otp },
        child.cookie,
        child.id,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await privatePost(child, '/review-code', {
        purpose: 'verify-current-email',
      })
    ).status,
  ).toBe(401);
  const next = await privatePost(child, '/review-code', {
    purpose: 'change-email',
  });
  expect(next.status).toBe(200);
  const changed = await call(
    '/email-otp/change-email',
    { newEmail: child.nextEmail, otp: next.body.otp },
    child.cookie,
    child.id,
  );
  expect(changed.status).toBe(200);
  expect(
    await owner.user.findUnique({ where: { id: child.id } }),
  ).toMatchObject({ email: child.nextEmail, isReviewLifecycle: true });
  expect(await owner.session.count({ where: { userId: child.id } })).toBe(0);
  expect(
    (
      await call('/email-otp/send-verification-otp', {
        email: child.nextEmail,
        type: 'sign-in',
      })
    ).status,
  ).toBe(403);
  expect(sent).toBe(0);
});
it('requires the disposable session for deletion proofs and executes real ledger-gated erasure', async () => {
  const child = await disposable('deletion');
  const before = await owner.user.count({ where: { id: child.parent.id } });
  const unauthenticated = await request(app)
    .post('/v1/account/deletion/start')
    .set('origin', 'portl://')
    .send({ email: child.email });
  expect(unauthenticated.status).toBe(401);
  expect(
    await owner.deletionChallenge.count({ where: { userId: child.id } }),
  ).toBe(0);
  const start = await privatePost(child, '/deletion/start', {
    email: child.email,
  });
  expect(start.status).toBe(200);
  const code = await privatePost(child, '/review-code', {
    purpose: 'delete-account',
  });
  expect(code.status).toBe(200);
  const input = {
    challengeId: start.body.challengeId,
    receiptToken: start.body.receiptToken,
    otp: code.body.otp,
    confirmation: 'DELETE',
    expectedUserId: child.id,
  };
  expect(
    (
      await request(app)
        .post('/v1/account/deletion/confirm')
        .set('origin', 'portl://')
        .send(input)
    ).status,
  ).toBe(401);
  expect(
    await owner.deletionChallenge.findUnique({
      where: { id: input.challengeId },
    }),
  ).toMatchObject({ attempts: 0 });
  const confirmed = await privatePost(child, '/deletion/confirm', input);
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.status).toBe('PENDING');
  expect(await owner.session.count({ where: { userId: child.id } })).toBe(0);
  const subject = accountProof(secret).subject(child.id);
  expect(
    await worker.$queryRaw`SELECT portl_auth.process_account_deletion(ARRAY[]::text[]) AS status`,
  ).toEqual([{ status: 'IDLE' }]);
  expect(
    await worker.$queryRaw`SELECT portl_auth.process_account_deletion(ARRAY[${subject}]::text[]) AS status`,
  ).toEqual([{ status: 'COMPLETED' }]);
  expect(await owner.user.findUnique({ where: { id: child.id } })).toBeNull();
  expect((await auth.accounts.deletionStatus(input.receiptToken)).status).toBe(
    'COMPLETED',
  );
  expect(await owner.user.count({ where: { id: child.parent.id } })).toBe(
    before,
  );
  await owner.accountDeletion.deleteMany({ where: { subjectHash: subject } });
  expect(sent).toBe(0);
});
it('denies cross-child codes, personal accounts, expired proofs and exhausted challenges', async () => {
  const a = await disposable('email-change'),
    b = await disposable('email-change', 1);
  expect(
    (
      await call(
        '/email-otp/send-verification-otp',
        { email: a.email, type: 'email-verification' },
        a.cookie,
        a.id,
      )
    ).status,
  ).toBe(200);
  expect(
    (await privatePost(b, '/review-code', { purpose: 'verify-current-email' }))
      .status,
  ).toBe(401);
  expect(
    (
      await privatePost(b, '/review-code', {
        purpose: 'verify-current-email',
        userId: a.id,
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await privatePost(
        { cookie: a.parent.cookie, id: a.parent.id },
        '/review-code',
        { purpose: 'verify-current-email' },
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await call(
        '/email-otp/send-verification-otp',
        { email: a.email, type: 'email-verification' },
        b.cookie,
        b.id,
      )
    ).status,
  ).toBe(400);
  const captured = await owner.reviewLifecycleCode.findUniqueOrThrow({
    where: {
      userId_purpose: { userId: a.id, purpose: 'verify-current-email' },
    },
  });
  expect(captured.cipherText).not.toMatch(/^\d{6}$/);
  await owner.verification.update({
    where: { identifier: `email-verification-otp-${a.email}` },
    data: { value: 'exhausted:3' },
  });
  expect(
    (await privatePost(a, '/review-code', { purpose: 'verify-current-email' }))
      .status,
  ).toBe(401);
  await owner.reviewLifecycleCode.update({
    where: {
      userId_purpose: { userId: a.id, purpose: 'verify-current-email' },
    },
    data: { expiresAt: new Date(0) },
  });
  expect(
    (await privatePost(a, '/review-code', { purpose: 'verify-current-email' }))
      .status,
  ).toBe(401);
});
it('rejects all society grants and reserved address adoption, and keeps the classification immutable', async () => {
  const child = await disposable('deletion');
  for (const sid of [societyId, otherSocietyId]) {
    for (const email of [
      child.email,
      child.nextEmail,
      `${randomUUID()}.before@lifecycle.review.portl.invalid`,
    ])
      expect(
        await owner.$queryRaw`SELECT portl_auth.reviewer_target_allowed(${sid},${email},'RESIDENT') AS allowed`,
      ).toEqual([{ allowed: false }]);
    await expect(
      owner.membership.create({
        data: { societyId: sid, userId: child.id, role: 'RESIDENT' },
      }),
    ).rejects.toThrow();
  }
  await expect(
    db.user.update({
      where: { id: child.id },
      data: { isReviewLifecycle: false },
    }),
  ).rejects.toThrow();
  await expect(
    db.user.update({
      where: { id: child.id },
      data: { email: 'real@example.com' },
    }),
  ).rejects.toThrow();
  await expect(
    db.user.update({
      where: { id: normalId },
      data: { email: child.nextEmail },
    }),
  ).rejects.toThrow();
  await expect(
    db.reviewLifecycle.delete({ where: { userId: child.id } }),
  ).rejects.toThrow();
  expect(
    (
      await request(app)
        .post('/v1/onboarding/society-lookup')
        .set('origin', 'portl://')
        .set('cookie', child.cookie)
        .send({ code: 'anything' })
    ).status,
  ).toBe(403);
});
it('invalidates children on parent session revocation and erases abandoned accounts through worker-only cleanup', async () => {
  const child = await disposable('email-change');
  await auth.accounts.revoke(
    child.parent.id,
    child.parent.sessionId,
    child.parent.sessionId,
  );
  expect(
    (await request(app).get('/v1/me').set('cookie', child.cookie)).status,
  ).toBe(401);
  expect(
    await (await call('/get-session', undefined, child.cookie)).json(),
  ).toBeNull();
  expect(
    (
      await call(
        '/email-otp/send-verification-otp',
        { email: child.email, type: 'email-verification' },
        child.cookie,
        child.id,
      )
    ).status,
  ).toBe(401);
  await expect(
    db.$executeRaw`SELECT portl_auth.cleanup_review_lifecycle()`,
  ).rejects.toThrow();
  await worker.$executeRaw`SELECT portl_auth.cleanup_review_lifecycle()`;
  expect(await owner.user.findUnique({ where: { id: child.id } })).toBeNull();
  expect(
    await owner.user.findUnique({ where: { id: child.parent.id } }),
  ).not.toBeNull();
});
it('fails closed on missing child metadata and disabled review realms, including already issued proofs', async () => {
  const child = await disposable('deletion');
  const start = await privatePost(child, '/deletion/start', {
    email: child.email,
  });
  expect(start.status).toBe(200);
  const code = await privatePost(child, '/review-code', {
    purpose: 'delete-account',
  });
  expect(code.status).toBe(200);
  await owner.reviewRealm.update({
    where: { id: 'play-review' },
    data: { enabled: false },
  });
  try {
    expect(
      (
        await privatePost(child, '/deletion/confirm', {
          challengeId: start.body.challengeId,
          receiptToken: start.body.receiptToken,
          otp: code.body.otp,
          confirmation: 'DELETE',
          expectedUserId: child.id,
        })
      ).status,
    ).toBe(401);
    expect(
      (await privatePost(child, '/review-code', { purpose: 'delete-account' }))
        .status,
    ).toBe(401);
    expect(
      (await request(app).get('/v1/me').set('cookie', child.cookie)).status,
    ).toBe(401);
  } finally {
    await owner.reviewRealm.update({
      where: { id: 'play-review' },
      data: { enabled: true },
    });
  }
  await owner.reviewLifecycle.delete({ where: { userId: child.id } });
  expect(
    (await request(app).get('/v1/me').set('cookie', child.cookie)).status,
  ).toBe(401);
  expect(
    await owner.user.findUnique({ where: { id: child.id } }),
  ).toMatchObject({ isReviewLifecycle: true });
  await worker.$executeRaw`SELECT portl_auth.cleanup_review_lifecycle()`;
  expect(await owner.user.findUnique({ where: { id: child.id } })).toBeNull();
});

it('rejects real mailbox targets before creating challenges or sending from a disposable identity', async () => {
  const child = await disposable('deletion');
  const user = await owner.user.findUniqueOrThrow({ where: { id: normalId } });
  expect(
    (
      await call(
        '/email-otp/send-verification-otp',
        { email: user.email, type: 'sign-in' },
        child.cookie,
        child.id,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        '/sign-in/email-otp',
        { email: user.email, otp: '123456', policyAcceptance: acceptance },
        child.cookie,
        child.id,
      )
    ).status,
  ).toBe(403);
  expect(
    (await privatePost(child, '/deletion/start', { email: user.email })).status,
  ).toBe(401);
  expect(
    await owner.verification.count({
      where: { identifier: `sign-in-otp-${user.email}` },
    }),
  ).toBe(0);
  expect(
    await owner.deletionChallenge.count({ where: { userId: normalId } }),
  ).toBe(0);
  expect(sent).toBe(0);
  await expect(db.user.delete({ where: { id: child.id } })).rejects.toThrow();
});
it('serializes concurrent disposable session replacement without returning two dead cookies', async () => {
  const parent = await signIn(0);
  const results = await Promise.all(
    [0, 1].map(() =>
      call(
        '/reviewer/lifecycle',
        { purpose: 'deletion' },
        parent.cookie,
        parent.id,
      ),
    ),
  );
  expect(results.some((result) => result.status === 200)).toBe(true);
  const statuses = await Promise.all(
    results
      .filter((r) => r.status === 200)
      .map((r) =>
        request(app)
          .get('/v1/me')
          .set(
            'cookie',
            r.headers
              .getSetCookie()
              .map((c) => c.split(';')[0])
              .join('; '),
          ),
      ),
  );
  expect(statuses.some((response) => response.status === 200)).toBe(true);
  const child = await owner.reviewLifecycle.findFirstOrThrow({
    where: { parentSessionId: parent.sessionId },
  });
  expect(await owner.session.count({ where: { userId: child.userId } })).toBe(
    1,
  );
});
it('rechecks parent authority inside the actual User mutation transaction after waiting on a revoked parent', async () => {
  const child = await disposable('email-change');
  let unlock!: () => void, locked!: () => void;
  const released = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const revoke = owner.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM portl_auth."User" WHERE id=${child.parent.id} FOR UPDATE`;
      await tx.session.deleteMany({ where: { id: child.parent.sessionId } });
      locked();
      await released;
    },
    { timeout: 15_000 },
  );
  await acquired;
  const change = db.user.update({
    where: { id: child.id },
    data: { email: child.nextEmail },
  });
  const rejected = expect(change).rejects.toThrow();
  unlock();
  await revoke;
  await rejected;
  expect(
    await owner.user.findUnique({ where: { id: child.id } }),
  ).toMatchObject({ email: child.email });
});
it('invalidates expired children, and allocation is idempotent and atomically capped across sessions', async () => {
  const first = await disposable('deletion');
  const again = await call(
    '/reviewer/lifecycle',
    { purpose: 'deletion' },
    first.parent.cookie,
    first.parent.id,
  );
  expect(again.status).toBe(200);
  expect(
    await owner.reviewLifecycle.count({ where: { parentId: first.parent.id } }),
  ).toBe(1);
  for (let i = 0; i < 5; i++) await disposable('deletion');
  const parent = await signIn(0);
  const overflow = await Promise.all([
    call(
      '/reviewer/lifecycle',
      { purpose: 'deletion' },
      parent.cookie,
      parent.id,
    ),
    call(
      '/reviewer/lifecycle',
      { purpose: 'email-change' },
      parent.cookie,
      parent.id,
    ),
  ]);
  expect(overflow.map((r) => r.status)).toEqual([401, 401]);
  expect(
    await owner.reviewLifecycle.count({ where: { parentId: parent.id } }),
  ).toBe(6);
  await owner.reviewLifecycle.update({
    where: { userId: first.id },
    data: { expiresAt: new Date(0) },
  });
  expect(
    (await request(app).get('/v1/me').set('cookie', first.cookie)).status,
  ).toBe(401);
  await worker.$executeRaw`SELECT portl_auth.cleanup_review_lifecycle()`;
  expect(await owner.user.findUnique({ where: { id: first.id } })).toBeNull();
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
  const child = await disposable('deletion', 1);
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
  expect(
    (await request(app).get('/v1/me').set('cookie', child.cookie)).status,
  ).toBe(401);
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

it('preserves ordinary OTP delivery and denies applying an ordinary deletion proof from a child session', async () => {
  const child = await disposable('deletion');
  const user = await owner.user.findUniqueOrThrow({ where: { id: normalId } });
  const baseline = sent;
  expect(
    (
      await call('/email-otp/send-verification-otp', {
        email: user.email,
        type: 'sign-in',
      })
    ).status,
  ).toBe(200);
  expect(sent).toBe(baseline + 1);
  const challenge = await auth.accounts.startDeletion(user.email);
  expect(sent).toBe(baseline + 2);
  const denied = await privatePost(child, '/deletion/confirm', {
    challengeId: challenge.challengeId,
    receiptToken: challenge.receiptToken,
    otp: sentCodes.at(-1),
    confirmation: 'DELETE',
    expectedUserId: normalId,
  });
  expect(denied.status).toBe(401);
  expect(
    await owner.user.findUnique({ where: { id: normalId } }),
  ).toMatchObject({ deletionRequestedAt: null });
  expect(
    await owner.deletionChallenge.findUnique({
      where: { id: challenge.challengeId },
    }),
  ).toMatchObject({ attempts: 0 });
});
