import request from 'supertest';
import { createApp } from '../app.js';
import { passCodes } from '../gate/pass-codes.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from '../database/client.js';
import { createAuth } from '../auth/auth.js';
import { accountService } from './service.js';
import { accountProof } from './proof.js';
import { withActor } from '../registry/context.js';
const owner = createDatabase(
  process.env.PORTL_TEST_DIRECT_DATABASE_URL ||
    process.env.DIRECT_DATABASE_URL!,
);
const db = createDatabase(process.env.PORTL_TEST_DATABASE_URL!);
const worker = createDatabase(process.env.WORKER_DATABASE_URL!);
const prefix = randomUUID();
const secret = 'account-integration-test-secret-at-least-32-characters';
const sent = new Map<string, string>();
let deliveryFails = false;
const deliver = async ({ email, otp }: { email: string; otp: string }) => {
  if (deliveryFails) throw new Error('synthetic failure');
  sent.set(email, otp);
};
const auth = createAuth(
  db,
  {
    DATABASE_URL: process.env.PORTL_TEST_DATABASE_URL!,
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: 'http://localhost:3000',
    TRUSTED_ORIGINS: ['portl://'],
    RESEND_API_KEY: 'fake',
    EMAIL_FROM: 'Test <test@example.com>',
  },
  deliver,
);
const service = accountService(db, accountProof(secret), deliver);
let uid: string, sessionId: string, cookie: string;
const otherId = randomUUID(),
  otherRequest = randomUUID(),
  otherNotice = randomUUID(),
  ownVisit = randomUUID(),
  otherVisit = randomUUID();
const holdTable = `account_hold_${prefix.replaceAll('-', '')}`;
const app = createApp(undefined, {
  auth,
  db,
  baseURL: 'http://localhost:3000',
  passCodes: passCodes(secret),
});
const email = `${prefix}@account-test.invalid`;
const sid = randomUUID(),
  towerId = randomUUID(),
  flatId = randomUUID(),
  gateId = randomUUID(),
  requestId = randomUUID(),
  noticeId = randomUUID(),
  passId = randomUUID(),
  occupancyId = randomUUID();
beforeAll(async () => {
  const call = (path: string, body: object) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: 'POST',
        headers: {
          origin: 'portl://',
          'content-type': 'application/json',
          'x-portl-client-ip': `10.${Math.floor(Math.random() * 240) + 1}.44.1`,
        },
        body: JSON.stringify({
          ...body,
          policyAcceptance: {
            adult: true,
            termsVersion: '2026-10-13',
            privacyVersion: '2026-10-13',
          },
        }),
      }),
    );
  expect(
    (await call('/email-otp/send-verification-otp', { email, type: 'sign-in' }))
      .status,
  ).toBe(200);
  const signed = await call('/sign-in/email-otp', {
    email,
    otp: sent.get(email),
  });
  expect(signed.status).toBe(200);
  uid = (await signed.json()).user.id;
  cookie = signed.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  sessionId = (await db.session.findFirstOrThrow({ where: { userId: uid } }))
    .id;
  await owner.society.create({
    data: { id: sid, name: 'Account Erasure Test', joinCodeHash: prefix },
  });
  await owner.tower.create({
    data: { id: towerId, societyId: sid, name: 'A' },
  });
  await owner.flat.create({
    data: { id: flatId, towerId, societyId: sid, label: '101' },
  });
  await owner.gate.create({
    data: { id: gateId, societyId: sid, name: 'Main' },
  });
  await owner.membership.createMany({
    data: ['ADMIN', 'RESIDENT', 'GUARD'].map((role) => ({
      societyId: sid,
      userId: uid,
      role: role as 'ADMIN' | 'RESIDENT' | 'GUARD',
    })),
  });
  await owner.occupancy.create({
    data: {
      id: occupancyId,
      societyId: sid,
      flatId,
      userId: uid,
      relationship: 'OWNER',
    },
  });
  await owner.guardAssignment.create({
    data: { societyId: sid, gateId, userId: uid, createdBy: uid },
  });
  await owner.visitorRequest.create({
    data: {
      id: requestId,
      societyId: sid,
      gateId,
      flatId,
      visitorName: 'Synthetic Guest',
      category: 'GUEST',
      createdBy: uid,
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  await owner.requestRecipient.create({
    data: {
      societyId: sid,
      requestId,
      userId: uid,
      occupancyId,
      occupancyStartedAt: (
        await owner.occupancy.findUniqueOrThrow({ where: { id: occupancyId } })
      ).startedAt,
    },
  });
  await owner.guestPass.create({
    data: {
      id: passId,
      societyId: sid,
      flatId,
      issuerId: uid,
      occupancyId,
      occupancyStartedAt: new Date(),
      visitorName: 'Synthetic Pass',
      tokenHash: prefix,
      cipherText: 'synthetic',
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 3600000),
    },
  });
  await owner.user.create({
    data: {
      id: otherId,
      email: `${prefix}-other@account-test.invalid`,
      emailVerified: true,
      name: 'Other account',
    },
  });
  await owner.membership.create({
    data: { userId: otherId, societyId: sid, role: 'GUARD' },
  });
  await owner.guardAssignment.create({
    data: { userId: otherId, societyId: sid, gateId, createdBy: uid },
  });
  await owner.visitorRequest.create({
    data: {
      id: otherRequest,
      societyId: sid,
      gateId,
      flatId,
      visitorName: 'Other guard guest',
      category: 'GUEST',
      createdBy: otherId,
      status: 'APPROVED',
      decidedBy: uid,
      decidedAt: new Date(),
      approvedUntil: new Date(Date.now() + 600000),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  await owner.visit.createMany({
    data: [
      {
        id: ownVisit,
        societyId: sid,
        requestId,
        enteredAt: new Date(),
        enteredBy: uid,
      },
      {
        id: otherVisit,
        societyId: sid,
        requestId: otherRequest,
        enteredAt: new Date(),
        enteredBy: uid,
      },
    ],
  });
  await owner.movementEvent.createMany({
    data: [ownVisit, otherVisit].map((visitId) => ({
      societyId: sid,
      visitId,
      type: 'ENTRY',
      gateId,
      actorId: uid,
    })),
  });
  await owner.notice.create({
    data: {
      id: otherNotice,
      societyId: sid,
      title: 'Other notice',
      body: 'Keep this content',
      createdBy: otherId,
    },
  });
  await owner.pushDevice.create({
    data: {
      id: randomUUID(),
      userId: uid,
      sessionId,
      generation: randomUUID(),
      platform: 'android',
      tokenHash: prefix,
      cipherText: 'synthetic',
    },
  });
  await owner.notice.create({
    data: {
      id: noticeId,
      societyId: sid,
      title: 'Synthetic',
      body: 'Account-created content',
      createdBy: uid,
    },
  });
}, 60000);
afterAll(async () => {
  await owner.$executeRawUnsafe(
    `DROP TABLE IF EXISTS portl_auth."${holdTable}"`,
  );
  await owner.movementEvent.deleteMany({ where: { societyId: sid } });
  await owner.visit.deleteMany({ where: { societyId: sid } });
  await owner.pushDevice.deleteMany({
    where: { userId: uid || 'no-account-created' },
  });
  await owner.requestRecipient.deleteMany({ where: { societyId: sid } });
  await owner.guestPass.deleteMany({ where: { societyId: sid } });
  await owner.visitorRequest.deleteMany({ where: { societyId: sid } });
  await owner.notice.deleteMany({ where: { societyId: sid } });
  await owner.guardAssignment.deleteMany({ where: { societyId: sid } });
  await owner.occupancy.deleteMany({ where: { societyId: sid } });
  await owner.membership.deleteMany({ where: { societyId: sid } });
  await owner.gate.deleteMany({ where: { societyId: sid } });
  await owner.flat.deleteMany({ where: { societyId: sid } });
  await owner.tower.deleteMany({ where: { societyId: sid } });
  await owner.society.deleteMany({ where: { id: sid } });
  await owner.accountDeletion.deleteMany({
    where: { subjectHash: accountProof(secret).subject(uid) },
  });
  await owner.user.deleteMany({ where: { id: { in: [uid, otherId] } } });
  await Promise.all([
    db.$disconnect(),
    owner.$disconnect(),
    worker.$disconnect(),
  ]);
}, 60000);
it('does not create identities or valid deletion proofs for unknown addresses or failed delivery', async () => {
  const missing = await service.startDeletion(
    `${prefix}-missing@account-test.invalid`,
  );
  expect(
    await db.deletionChallenge.findUnique({
      where: { id: missing.challengeId },
    }),
  ).toBeNull();
  deliveryFails = true;
  const failed = await service.startDeletion(email);
  deliveryFails = false;
  expect(
    await db.deletionChallenge.findUnique({
      where: { id: failed.challengeId },
    }),
  ).toBeNull();
});
it('persists wrong attempts, rejects expired and account-substituted proofs', async () => {
  const challenge = await service.startDeletion(email);
  const wrong = sent.get(email) === '000000' ? '111111' : '000000';
  for (let i = 0; i < 3; i++)
    await expect(
      service.confirmDeletion({
        ...challenge,
        otp: wrong,
        confirmation: 'DELETE',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DELETION_CODE' });
  await expect(
    service.confirmDeletion({
      ...challenge,
      otp: sent.get(email)!,
      confirmation: 'DELETE',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_DELETION_CODE' });
  const next = await service.startDeletion(email);
  await expect(
    service.confirmDeletion({
      ...next,
      otp: sent.get(email)!,
      confirmation: 'DELETE',
      expectedUserId: 'another-user',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_DELETION_CODE' });
  await db.deletionChallenge.update({
    where: { id: next.challengeId },
    data: { expiresAt: new Date(0) },
  });
  await expect(
    service.confirmDeletion({
      ...next,
      otp: sent.get(email)!,
      confirmation: 'DELETE',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_DELETION_CODE' });
  expect(
    await db.user.findUnique({
      where: { id: uid },
      select: { deletionRequestedAt: true },
    }),
  ).toEqual({ deletionRequestedAt: null });
});
it('gates existing sessions until adult policy acceptance, while keeping deletion and legal pages accessible', async () => {
  await db.accountPolicy.delete({ where: { userId: uid } });
  expect(
    await auth.api.getSession({ headers: new Headers({ cookie }) }),
  ).toBeNull();
  expect(
    (await request(app).get('/v1/me').set('cookie', cookie)).body
      .policyRequired,
  ).toBe(true);
  expect(
    (
      await request(app)
        .get('/v1/onboarding/applications')
        .set('cookie', cookie)
    ).status,
  ).toBe(401);
  const route = () =>
    request(app)
      .post('/v1/account/accept-policy')
      .set('cookie', cookie)
      .set('expo-origin', 'portl://')
      .set('x-portl-expected-user', uid);
  expect(
    (
      await route().send({
        adult: false,
        termsVersion: '2026-10-13',
        privacyVersion: '2026-10-13',
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await route().send({
        adult: true,
        termsVersion: '2026-10-13',
        privacyVersion: '2026-10-13',
      })
    ).status,
  ).toBe(200);
  expect(
    await auth.api.getSession({ headers: new Headers({ cookie }) }),
  ).not.toBeNull();
  for (const path of ['/privacy', '/terms', '/support', '/delete-account']) {
    const page = await request(app).get(path);
    expect(page.status).toBe(200);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['content-security-policy']).toContain(
      "form-action 'self'",
    );
  }
  expect(
    (
      await request(app)
        .post('/v1/account/deletion/start')
        .set('origin', 'https://evil.invalid')
        .send({ email })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .post('/delete-account/start')
        .set('origin', 'http://localhost:3000')
        .type('form')
        .send({ email: `${prefix}-web@account-test.invalid` })
    ).text,
  ).toContain('private receipt');
});
it('revokes immediately, retries the same receipt safely, and erases sole-admin content with restricted worker authority', async () => {
  const challenge = await service.startDeletion(email);
  const input = {
    ...challenge,
    otp: sent.get(email)!,
    confirmation: 'DELETE' as const,
    expectedUserId: uid,
  };
  const [one, two] = await Promise.all([
    service.confirmDeletion(input),
    service.confirmDeletion(input),
  ]);
  expect(one.status).toBe('PENDING');
  expect(two).toEqual(one);
  expect(
    await auth.api.getSession({ headers: new Headers({ cookie }) }),
  ).toBeNull();
  await expect(
    withActor(
      db,
      { userId: uid, email, sessionId, requestId: randomUUID() },
      async () => true,
    ),
  ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  await expect(
    db.$queryRaw`SELECT portl_auth.process_account_deletion(${[accountProof(secret).subject(uid)]}::text[])`,
  ).rejects.toThrow();
  expect(await owner.pushDevice.count({ where: { userId: uid } })).toBe(0);
  expect(
    await worker.$queryRaw`SELECT portl_auth.process_account_deletion(${[]}::text[]) AS status`,
  ).toEqual([{ status: 'IDLE' }]);
  expect(await db.user.findUnique({ where: { id: uid } })).not.toBeNull();
  // Simulate a new, unhandled foreign-key dependency: cleanup must roll back and retry.
  await owner.$executeRawUnsafe(
    `CREATE TABLE portl_auth."${holdTable}" ("userId" text REFERENCES portl_auth."User"(id))`,
  );
  await owner.$executeRawUnsafe(
    `INSERT INTO portl_auth."${holdTable}" VALUES ($1)`,
    uid,
  );
  expect(
    await worker.$queryRaw`SELECT portl_auth.process_account_deletion(${[accountProof(secret).subject(uid)]}::text[]) AS status`,
  ).toEqual([{ status: 'RETRY' }]);
  expect(
    await owner.notice.findUnique({ where: { id: noticeId } }),
  ).not.toBeNull();
  expect(await db.user.findUnique({ where: { id: uid } })).not.toBeNull();
  expect(
    await db.accountDeletion.findUnique({
      where: { id: challenge.challengeId },
    }),
  ).toMatchObject({ status: 'PENDING', attempts: 1 });
  await owner.$executeRawUnsafe(`DROP TABLE portl_auth."${holdTable}"`);
  await owner.accountDeletion.update({
    where: { id: challenge.challengeId },
    data: { nextAttemptAt: new Date(0) },
  });
  expect(
    await worker.$queryRaw`SELECT portl_auth.process_account_deletion(${[accountProof(secret).subject(uid)]}::text[]) AS status`,
  ).toEqual([{ status: 'COMPLETED' }]);
  expect((await service.deletionStatus(challenge.receiptToken)).status).toBe(
    'COMPLETED',
  );
  expect(await db.user.findUnique({ where: { id: uid } })).toBeNull();
  expect(await owner.visitorRequest.count({ where: { id: requestId } })).toBe(
    0,
  );
  expect(await owner.guestPass.count({ where: { societyId: sid } })).toBe(0);
  expect(await owner.notice.count({ where: { id: noticeId } })).toBe(0);
  expect(await owner.membership.count({ where: { userId: uid } })).toBe(0);
  expect(
    await owner.notice.findUnique({ where: { id: otherNotice } }),
  ).toMatchObject({ createdBy: otherId });
  expect(
    await owner.visitorRequest.findUnique({ where: { id: otherRequest } }),
  ).toMatchObject({
    createdBy: otherId,
    decidedBy: 'deleted-account',
    status: 'APPROVED',
  });
  expect(await owner.visit.findUnique({ where: { id: ownVisit } })).toBeNull();
  expect(
    await owner.visit.findUnique({ where: { id: otherVisit } }),
  ).toMatchObject({ enteredBy: 'deleted-account' });
  expect(
    await owner.movementEvent.findFirst({ where: { visitId: otherVisit } }),
  ).toMatchObject({ actorId: 'deleted-account' });
  expect(
    await owner.guardAssignment.findFirst({ where: { userId: otherId } }),
  ).toMatchObject({ createdBy: 'deleted-account' });
  await expect(
    db.user.create({
      data: {
        id: randomUUID(),
        email,
        emailVerified: true,
        name: 'Stale creation',
      },
    }),
  ).rejects.toThrow();
  expect(await owner.society.findUnique({ where: { id: sid } })).not.toBeNull();
  expect(
    await worker.$queryRaw`SELECT portl_auth.process_account_deletion(${[accountProof(secret).subject(uid)]}::text[]) AS status`,
  ).toEqual([{ status: 'IDLE' }]);
}, 60000);
