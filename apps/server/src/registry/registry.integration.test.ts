import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { symmetricEncrypt } from 'better-auth/crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { createDatabase } from '../database/client.js';
import { hash, withActor, scope, type Actor } from './context.js';

const runtime = process.env.PORTL_TEST_DATABASE_URL;
const direct =
  process.env.PORTL_TEST_DIRECT_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
if (!runtime || !direct)
  throw new Error('Restricted test and fixture-owner URLs required');
const db = createDatabase(runtime);
const owner = createDatabase(direct);
const secret = 'portl-registry-test-only-secret-at-least-32-chars';
const prefix = randomUUID();
const sent = new Map<string, string>();
const auth = createAuth(
  db,
  {
    DATABASE_URL: runtime,
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: 'http://localhost:3000',
    TRUSTED_ORIGINS: ['portl://', 'http://localhost:8090'],
    RESEND_API_KEY: 'fake',
    EMAIL_FROM: 'Portl <auth@example.com>',
  },
  async ({ email, otp }) => {
    sent.set(email, otp);
  },
);
const app = createApp(undefined, {
  auth,
  db,
  baseURL: 'http://localhost:3000',
});
const users: {
  id: string;
  email: string;
  sessionId: string;
  cookie: string;
}[] = [];
const societies: string[] = [];
let ip = 0;
const totpSecret = randomBytes(24).toString('hex');
function totp(offset = 0) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const mac = createHmac('sha1', totpSecret).update(counter).digest();
  const start = mac[mac.length - 1]! & 15;
  return String((mac.readUInt32BE(start) & 0x7fffffff) % 1_000_000).padStart(
    6,
    '0',
  );
}
async function login(index = users.length) {
  const email = `${prefix}-${index}@registry-test.invalid`;
  const call = (path: string, body: object) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: 'POST',
        headers: {
          origin: 'portl://',
          'content-type': 'application/json',
          'x-portl-client-ip': `192.0.2.${++ip}`,
        },
        body: JSON.stringify(body),
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
  const { user } = await signed.json();
  const session = await db.session.findFirstOrThrow({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  const result = {
    id: user.id as string,
    email,
    sessionId: session.id,
    cookie: signed.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  };
  users.push(result);
  return result;
}
function api(
  user: (typeof users)[number],
  method: 'get' | 'post',
  path: string,
  body?: object,
) {
  const caller = request(app);
  const call = caller[method](path)
    .set('cookie', user.cookie)
    .set('origin', 'portl://');
  return method === 'post' ? call.send(body || {}) : call;
}
let admin: (typeof users)[number],
  applicant: (typeof users)[number],
  outsider: (typeof users)[number];
let sid: string, otherSid: string, flatId: string, otherFlatId: string;
const code = randomBytes(6).toString('hex').toUpperCase();
const otherCode = randomBytes(6).toString('hex').toUpperCase();
const adminPath = (suffix: string) => `/v1/societies/${sid}/admin/${suffix}`;
async function assure(user = admin, value = totp()) {
  return api(user, 'post', '/api/auth/two-factor/verify-totp', {
    code: value,
    trustDevice: false,
  });
}
async function invite(user = applicant, relationship = 'TENANT') {
  const result = await api(admin, 'post', adminPath('invitations'), {
    email: user.email,
    flatId,
    relationship,
  });
  expect(result.status).toBe(201);
  return result.body;
}
async function apply(
  user: (typeof users)[number],
  societyId = sid,
  targetFlat = flatId,
  sharedCode = code,
) {
  const response = await api(
    user,
    'post',
    `/v1/societies/${societyId}/applications`,
    {
      name: 'Test Resident',
      societyCode: sharedCode,
      flatId: targetFlat,
      relationship: 'TENANT',
    },
  );
  return response;
}

beforeAll(async () => {
  admin = await login();
  applicant = await login();
  outsider = await login();
  for (const shared of [code, otherCode]) {
    const society = await owner.society.create({
      data: {
        name: `Synthetic ${prefix}`,
        joinCodeHash: hash(shared),
        towers: { create: { name: 'A' } },
      },
      include: { towers: true },
    });
    societies.push(society.id);
    const flat = await owner.flat.create({
      data: {
        societyId: society.id,
        towerId: society.towers[0]!.id,
        label: '101',
      },
    });
    if (shared === code) {
      sid = society.id;
      flatId = flat.id;
    } else {
      otherSid = society.id;
      otherFlatId = flat.id;
    }
  }
  await owner.membership.create({
    data: { societyId: sid, userId: admin.id, role: 'ADMIN' },
  });
  await owner.user.update({
    where: { id: admin.id },
    data: { twoFactorEnabled: true },
  });
  await owner.twoFactor.create({
    data: {
      id: randomUUID(),
      userId: admin.id,
      secret: await symmetricEncrypt({ key: secret, data: totpSecret }),
      backupCodes: '[]',
      verified: true,
    },
  });
});
afterAll(async () => {
  await owner.registryAudit.deleteMany({
    where: { societyId: { in: societies } },
  });
  await owner.residentApplication.deleteMany({
    where: { societyId: { in: societies } },
  });
  await owner.invitation.deleteMany({
    where: { societyId: { in: societies } },
  });
  await owner.occupancy.deleteMany({ where: { societyId: { in: societies } } });
  await owner.membership.deleteMany({
    where: { societyId: { in: societies } },
  });
  await owner.flat.deleteMany({ where: { societyId: { in: societies } } });
  await owner.tower.deleteMany({ where: { societyId: { in: societies } } });
  await owner.society.deleteMany({ where: { id: { in: societies } } });
  await owner.adminTotpUse.deleteMany({
    where: { userId: { in: users.map((u) => u.id) } },
  });
  await owner.user.deleteMany({
    where: { id: { in: users.map((u) => u.id) } },
  });
  await db.verification.deleteMany({
    where: { identifier: { in: users.map((u) => `sign-in-otp-${u.email}`) } },
  });
  await db.$disconnect();
  await owner.$disconnect();
});

describe('resident onboarding with real PostgreSQL and RLS', () => {
  it('allows credentialed browser requests only from an exact trusted origin', async () => {
    const preflight = await request(app)
      .options('/v1/onboarding/society-lookup')
      .set('origin', 'http://localhost:8090')
      .set('access-control-request-method', 'POST')
      .set('access-control-request-headers', 'content-type');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(
      'http://localhost:8090',
    );
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    expect(
      (
        await request(app)
          .options('/v1/me')
          .set('origin', 'https://evil.invalid')
      ).status,
    ).toBe(403);
    const forged = await request(app)
      .post('/v1/onboarding/society-lookup')
      .set('cookie', applicant.cookie)
      .set('origin', 'https://evil.invalid')
      .send({ code });
    expect(forged.status).toBe(403);
    expect(forged.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('requires server-side admin assurance and keeps passwordless enrollment closed', async () => {
    expect(
      (await api(admin, 'get', adminPath('applications'))).body.error.code,
    ).toBe('ADMIN_STEP_UP_REQUIRED');
    expect(
      (await api(admin, 'post', '/api/auth/two-factor/enable', {})).status,
    ).toBe(404);
    expect((await assure(admin, '000000')).status).toBe(401);
    const validCode = totp();
    expect((await assure(admin, validCode)).status).toBe(200);
    expect((await api(admin, 'get', adminPath('applications'))).status).toBe(
      200,
    );
    // Reuse the exact submitted code, even if the clock crosses a TOTP window.
    expect((await assure(admin, validCode)).status).toBe(409);
  });
  it('does not grant authority from a society code or pending application', async () => {
    const found = await api(
      applicant,
      'post',
      '/v1/onboarding/society-lookup',
      { code },
    );
    expect(found.status).toBe(200);
    expect(found.body.flats[0].label).toBe('101');
    expect(found.body).not.toHaveProperty('residents');
    const submitted = await apply(applicant);
    expect(submitted.status).toBe(201);
    expect((await api(applicant, 'get', '/v1/me')).body.memberships).toEqual(
      [],
    );
    expect(
      (await api(applicant, 'get', adminPath('applications'))).status,
    ).toBe(403);
    expect((await apply(applicant)).status).toBe(409);
    expect(
      (await api(outsider, 'get', '/v1/onboarding/applications')).body.items,
    ).toEqual([]);
  });
  it('rejects tenant substitution, role injection and missing admission code', async () => {
    expect((await apply(outsider, sid, otherFlatId)).status).toBe(404);
    expect(
      (
        await api(outsider, 'post', `/v1/societies/${sid}/applications`, {
          name: 'Test Resident',
          flatId,
          relationship: 'TENANT',
          societyCode: code,
          role: 'ADMIN',
        })
      ).status,
    ).toBe(422);
    expect((await apply(outsider, sid, flatId, otherCode)).status).toBe(404);
    expect(
      (await api(admin, 'get', `/v1/societies/${otherSid}/admin/applications`))
        .status,
    ).toBe(403);
  });
  it('binds invitations to verified email, stores only a digest and rejects replay', async () => {
    const recipient = await login();
    const invitation = await invite(recipient);
    const stored = await owner.invitation.findUniqueOrThrow({
      where: { id: invitation.invitation.id },
    });
    expect(stored.tokenHash).not.toContain(invitation.token);
    expect(
      (
        await api(outsider, 'post', '/v1/onboarding/invitation-preview', {
          token: invitation.token,
        })
      ).status,
    ).toBe(404);
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        api(recipient, 'post', '/v1/onboarding/invitation-accept', {
          token: invitation.token,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      await owner.membership.count({
        where: { societyId: sid, userId: recipient.id, role: 'RESIDENT' },
      }),
    ).toBe(1);
    expect(
      (
        await api(recipient, 'post', '/v1/onboarding/invitation-accept', {
          token: invitation.token,
        })
      ).status,
    ).toBe(404);
    expect(
      (await api(recipient, 'get', '/v1/me')).body.memberships[0].flats[0]
        .relationship,
    ).toBe('TENANT');
  });
  it('reconciles simultaneous invitation acceptance and application approval', async () => {
    const recipient = await login();
    const submitted = await apply(recipient);
    expect(submitted.status).toBe(201);
    const invitation = await invite(recipient);
    const results = await Promise.all([
      api(recipient, 'post', '/v1/onboarding/invitation-accept', {
        token: invitation.token,
      }),
      api(
        admin,
        'post',
        adminPath(`applications/${submitted.body.id}/decision`),
        { decision: 'APPROVE' },
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(
      await owner.occupancy.count({
        where: { societyId: sid, userId: recipient.id },
      }),
    ).toBe(1);
    expect(
      await owner.registryAudit.count({
        where: {
          societyId: sid,
          resourceId: { in: [submitted.body.id, invitation.invitation.id] },
          action: { in: ['INVITATION_ACCEPTED', 'APPLICATION_APPROVED'] },
        },
      }),
    ).toBe(2);
  });
  it('serializes conflicting review decisions and rejects repeated decisions', async () => {
    const recipient = await login();
    const submitted = await apply(recipient);
    const results = await Promise.all([
      api(
        admin,
        'post',
        adminPath(`applications/${submitted.body.id}/decision`),
        { decision: 'APPROVE' },
      ),
      api(
        admin,
        'post',
        adminPath(`applications/${submitted.body.id}/decision`),
        { decision: 'REJECT', reason: 'CONTACT_SOCIETY_OFFICE' },
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await owner.membership.count({
        where: { societyId: sid, userId: recipient.id },
      }),
    ).toBeLessThanOrEqual(1);
  });
  it('supports rejection, own withdrawal and a fresh application without any grants', async () => {
    const recipient = await login();
    const submitted = await apply(recipient);
    expect(
      (
        await api(
          admin,
          'post',
          adminPath(`applications/${submitted.body.id}/decision`),
          { decision: 'REJECT', reason: 'INCORRECT_FLAT' },
        )
      ).status,
    ).toBe(200);
    expect(
      (await api(recipient, 'get', '/v1/onboarding/applications')).body.items[0]
        .reason,
    ).toBe('INCORRECT_FLAT');
    const next = await apply(recipient);
    expect(next.status).toBe(201);
    expect(
      (
        await api(
          outsider,
          'post',
          `/v1/onboarding/applications/${next.body.id}/withdraw`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await api(
          recipient,
          'post',
          `/v1/onboarding/applications/${next.body.id}/withdraw`,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await api(
          admin,
          'post',
          adminPath(`applications/${next.body.id}/decision`),
          { decision: 'APPROVE' },
        )
      ).status,
    ).toBe(409);
    expect((await api(recipient, 'get', '/v1/me')).body.memberships).toEqual(
      [],
    );
  });
  it('rejects expired/revoked invitations and a grantor whose membership was revoked', async () => {
    const recipient = await login();
    const first = await invite(recipient);
    const second = await invite(recipient);
    const third = await invite(recipient);
    await owner.invitation.update({
      where: { id: first.invitation.id },
      data: { expiresAt: new Date(0) },
    });
    expect(
      (
        await api(
          admin,
          'post',
          adminPath(`invitations/${second.invitation.id}/revoke`),
        )
      ).status,
    ).toBe(200);
    for (const token of [first.token, second.token])
      expect(
        (
          await api(recipient, 'post', '/v1/onboarding/invitation-accept', {
            token,
          })
        ).status,
      ).toBe(404);
    await owner.membership.updateMany({
      where: { societyId: sid, userId: admin.id, role: 'ADMIN' },
      data: { active: false },
    });
    expect(
      (
        await api(recipient, 'post', '/v1/onboarding/invitation-accept', {
          token: third.token,
        })
      ).status,
    ).toBe(404);
    expect((await api(admin, 'get', adminPath('applications'))).status).toBe(
      403,
    );
    await owner.membership.updateMany({
      where: { societyId: sid, userId: admin.id, role: 'ADMIN' },
      data: { active: true },
    });
  });
  it('fails closed without transaction context and isolates pooled contexts', async () => {
    expect(await db.membership.findMany()).toEqual([]);
    expect(await db.society.findMany()).toEqual([]);
    const actor: Actor = {
      userId: applicant.id,
      email: applicant.email,
      sessionId: applicant.sessionId,
      requestId: 'test',
    };
    await withActor(db, actor, async (tx) => {
      await scope(tx, sid);
      expect((await tx.flat.findMany()).map((f) => f.id)).toEqual([flatId]);
    });
    await withActor(db, actor, async (tx) => {
      await scope(tx, otherSid);
      expect((await tx.flat.findMany()).map((f) => f.id)).toEqual([
        otherFlatId,
      ]);
    });
    expect(await db.flat.findMany()).toEqual([]);
    await expect(db.registryAudit.deleteMany()).rejects.toThrow();
  });
  it('blocks expired assurance even with a valid identity session', async () => {
    await owner.adminAssurance.update({
      where: { sessionId: admin.sessionId },
      data: { expiresAt: new Date(0) },
    });
    expect(
      (await api(admin, 'get', adminPath('invitations'))).body.error.code,
    ).toBe('ADMIN_STEP_UP_REQUIRED');
    expect(
      (await api(admin, 'get', '/v1/me')).body.adminAssuredUntil,
    ).toBeNull();
  });
  it('caps authenticator guesses even when Better Auth sees an active session', async () => {
    await owner.user.update({
      where: { id: outsider.id },
      data: { twoFactorEnabled: true },
    });
    await owner.twoFactor.create({
      data: {
        id: randomUUID(),
        userId: outsider.id,
        secret: await symmetricEncrypt({ key: secret, data: totpSecret }),
        backupCodes: '[]',
        verified: true,
      },
    });
    // Never use a potentially valid code, including the plugin's adjacent windows.
    const valid = new Set([totp(-1), totp(), totp(1)]);
    let wrong = '000000';
    while (valid.has(wrong)) wrong = String(Number(wrong) + 1).padStart(6, '0');
    // Better Auth may apply an additional, stricter endpoint limit before ours.
    for (let attempt = 0; attempt < 5; attempt++)
      expect([401, 429]).toContain((await assure(outsider, wrong)).status);
    expect((await assure(outsider, wrong)).status).toBe(429);
    expect(
      await db.adminAssurance.findUnique({
        where: { sessionId: outsider.sessionId },
      }),
    ).toBeNull();
  });
});
