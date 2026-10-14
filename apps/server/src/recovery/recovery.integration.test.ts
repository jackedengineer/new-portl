import request from 'supertest';
import { createAuth } from '../auth/auth.js';
import { createApp } from '../app.js';
import { passCodes } from '../gate/pass-codes.js';
import { emailThrottleKey } from '../auth/throttle.js';
import { randomUUID } from 'node:crypto';
import { createOTP } from '@better-auth/utils/otp';
import { symmetricEncrypt, symmetricDecrypt } from 'better-auth/crypto';
import { POLICY_VERSION } from '@portl/contracts';
import { afterAll, expect, it, vi } from 'vitest';
import { createDatabase } from '../database/client.js';
import { prepareRecovery, cancelRecovery } from './operator.js';
import { adminRecoveryService } from './service.js';
import { recoveryEmailProof } from './proof.js';
const url = process.env.PORTL_TEST_DATABASE_URL;
if (!url) throw new Error('An isolated test database is required');
const owner = createDatabase(
  process.env.PORTL_TEST_DIRECT_DATABASE_URL ||
    process.env.DIRECT_DATABASE_URL!,
);
const db = createDatabase(url),
  worker = createDatabase(process.env.WORKER_DATABASE_URL!);
const secret = 'recovery-test-only-secret-at-least-thirty-two-characters';
const service = adminRecoveryService(db, secret),
  uids: string[] = [],
  sids: string[] = [];
async function fixture(admin = false, societyId?: string) {
  const uid = randomUUID(),
    email = `${uid}@recovery-test.invalid`,
    sessionId = randomUUID(),
    oldSecret = randomUUID();
  uids.push(uid);
  await owner.user.create({
    data: {
      id: uid,
      email,
      name: 'Recovery fixture',
      emailVerified: true,
      twoFactorEnabled: admin,
    },
  });
  await owner.accountPolicy.create({
    data: { userId: uid, version: POLICY_VERSION, adult: true },
  });
  await owner.session.create({
    data: {
      id: sessionId,
      userId: uid,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  if (!societyId) {
    societyId = randomUUID();
    sids.push(societyId);
    await owner.society.create({
      data: {
        id: societyId,
        name: 'Recovery fictional society',
        joinCodeHash: randomUUID(),
      },
    });
  }
  if (admin) {
    await owner.membership.create({
      data: { societyId, userId: uid, role: 'ADMIN' },
    });
    await owner.twoFactor.create({
      data: {
        id: randomUUID(),
        userId: uid,
        secret: await symmetricEncrypt({ key: secret, data: oldSecret }),
        backupCodes: '[]',
      },
    });
  }
  let otp = '';
  const input = {
    operation: admin ? 'RESET_AUTHENTICATOR' : 'RESTORE_ADMIN',
    targetEmail: email,
    ...(!admin ? { societyId } : {}),
    operatorId: 'operator-test',
    evidenceRef: 'case-test',
    identityVerified: true,
    societyAuthorityVerified: true,
  };
  const prepare = () =>
    prepareRecovery(owner, secret, input, async (message) => {
      otp = message.otp;
      expect(message.purpose).toBe('admin-recovery');
    });
  const codes = async (id: string) => {
    const enrollment = await service.enroll(uid, sessionId, id);
    const row = await owner.operatorRecovery.findUniqueOrThrow({
      where: { id },
    });
    const newSecret = await symmetricDecrypt({
      key: secret,
      data: row.encryptedSecret!,
    });
    expect(new URL(enrollment.totpURI).searchParams.get('secret')).toBe(
      enrollment.setupKey,
    );
    return {
      id,
      otp,
      totpCode: await createOTP(newSecret).totp(),
      confirmation: 'RECOVER' as const,
      newSecret,
    };
  };
  return { uid, email, sessionId, societyId, oldSecret, input, prepare, codes };
}
afterAll(async () => {
  await owner.registryAudit.deleteMany({ where: { societyId: { in: sids } } });
  await owner.membership.deleteMany({ where: { societyId: { in: sids } } });
  await owner.user.deleteMany({ where: { id: { in: uids } } });
  await owner.society.deleteMany({ where: { id: { in: sids } } });
  await Promise.all([
    owner.$disconnect(),
    db.$disconnect(),
    worker.$disconnect(),
  ]);
});
it('keeps preparation and stored proofs unavailable to runtime and worker roles', async () => {
  const f = await fixture();
  for (const client of [db, worker]) {
    await expect(
      prepareRecovery(client, secret, f.input, async () => {}),
    ).rejects.toThrow('migration-owner');
    await expect(client.operatorRecovery.findMany()).rejects.toThrow();
  }
  const r = await f.prepare();
  const other = await fixture();
  expect((await service.status(other.uid, other.sessionId)).request).toBeNull();
  await expect(
    service.enroll(other.uid, other.sessionId, r.id),
  ).rejects.toMatchObject({ code: 'INVALID_RECOVERY_PROOF' });
  await expect(service.status(f.uid, other.sessionId)).rejects.toThrow();
  expect(
    await owner.membership.count({ where: { userId: f.uid, role: 'ADMIN' } }),
  ).toBe(0);
});
it('requires verified current-policy identities and an eligible recovery scope', async () => {
  const f = await fixture();
  await owner.accountPolicy.delete({ where: { userId: f.uid } });
  await expect(f.prepare()).rejects.toThrow('current adult-account policy');
  await owner.accountPolicy.create({
    data: { userId: f.uid, version: POLICY_VERSION, adult: true },
  });
  await owner.user.update({
    where: { id: f.uid },
    data: { emailVerified: false },
  });
  await expect(f.prepare()).rejects.toThrow();
  await owner.user.update({
    where: { id: f.uid },
    data: { emailVerified: true, deletionRequestedAt: new Date() },
  });
  await expect(f.prepare()).rejects.toThrow();
  const existing = await fixture(true),
    target = await fixture(false, existing.societyId);
  await expect(target.prepare()).rejects.toThrow('no active admin');
  const ordinary = await fixture();
  await expect(
    prepareRecovery(
      owner,
      secret,
      {
        ...ordinary.input,
        operation: 'RESET_AUTHENTICATOR',
        societyId: undefined,
      },
      async () => {},
    ),
  ).rejects.toThrow('active admin');
});

it('keeps database recovery guards aligned with the revised accepted policy', async () => {
  const f = await fixture(true);
  await owner.accountPolicy.update({
    where: { userId: f.uid },
    data: { version: '2026-10-13' },
  });
  const view = () =>
    db.$queryRaw`SELECT portl_auth.admin_recovery_view(${f.uid},${f.sessionId})`;
  const complete = () =>
    db.$queryRaw<
      { result: string }[]
    >`SELECT portl_auth.complete_admin_recovery(${randomUUID()},${f.uid},${f.sessionId},'unused',false,'unused') AS result`;
  await expect(view()).rejects.toThrow('Account authorization required');
  expect((await complete())[0]?.result).toBe('UNAVAILABLE');

  await owner.accountPolicy.update({
    where: { userId: f.uid },
    data: { version: POLICY_VERSION },
  });
  await expect(view()).resolves.toHaveLength(1);
  // Current acceptance reaches request validation, without performing recovery.
  expect((await complete())[0]?.result).toBe('INVALID');
});
it('commits wrong attempts and locks the request after three failures without granting access', async () => {
  const f = await fixture(),
    r = await f.prepare(),
    p = await f.codes(r.id);
  for (let n = 0; n < 3; n++)
    await expect(
      service.confirm(f.uid, f.sessionId, {
        id: p.id,
        otp: p.otp === '000000' ? '111111' : '000000',
        totpCode: p.totpCode,
        confirmation: 'RECOVER',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RECOVERY_PROOF' });
  expect(
    await owner.operatorRecovery.findUnique({ where: { id: r.id } }),
  ).toMatchObject({
    attempts: 3,
    status: 'CANCELLED',
    otpHash: null,
    encryptedSecret: null,
  });
  await expect(
    service.confirm(f.uid, f.sessionId, {
      id: p.id,
      otp: p.otp,
      totpCode: p.totpCode,
      confirmation: 'RECOVER',
    }),
  ).rejects.toThrow();
  expect(
    await owner.membership.count({ where: { userId: f.uid, role: 'ADMIN' } }),
  ).toBe(0);
});
it('rejects expiry, cancellation and changed authenticators', async () => {
  for (const state of ['expired', 'cancelled', 'changed']) {
    const f = await fixture(true),
      r = await f.prepare(),
      p = await f.codes(r.id);
    if (state === 'expired')
      await owner.operatorRecovery.update({
        where: { id: r.id },
        data: { expiresAt: new Date(0) },
      });
    if (state === 'cancelled') await cancelRecovery(owner, r.id);
    if (state === 'changed')
      await owner.twoFactor.update({
        where: { userId: f.uid },
        data: {
          secret: await symmetricEncrypt({ key: secret, data: randomUUID() }),
        },
      });
    await expect(
      service.confirm(f.uid, f.sessionId, {
        id: p.id,
        otp: p.otp,
        totpCode: p.totpCode,
        confirmation: 'RECOVER',
      }),
    ).rejects.toThrow();
    expect(
      await owner.session.findUnique({ where: { id: f.sessionId } }),
    ).not.toBeNull();
  }
});
it('cancels only the failed-send request and rejects rapid operator preparations', async () => {
  const f = await fixture(),
    deliver = vi.fn().mockRejectedValue(new Error('provider unavailable'));
  await expect(
    prepareRecovery(owner, secret, f.input, deliver),
  ).rejects.toThrow('email failed');
  expect(
    await owner.operatorRecovery.findFirst({ where: { userId: f.uid } }),
  ).toMatchObject({
    status: 'CANCELLED',
    encryptedSecret: null,
    otpHash: null,
  });
  await expect(f.prepare()).rejects.toThrow('Wait');
});
it('resets an admin factor, preserves role scope and atomically revokes access', async () => {
  const f = await fixture(true);
  const old = (
    await owner.twoFactor.findUniqueOrThrow({ where: { userId: f.uid } })
  ).secret;
  await owner.adminAssurance.create({
    data: { sessionId: f.sessionId, expiresAt: new Date(Date.now() + 600000) },
  });
  await owner.pushDevice.create({
    data: {
      id: randomUUID(),
      userId: f.uid,
      sessionId: f.sessionId,
      generation: randomUUID(),
      platform: 'android',
      tokenHash: randomUUID(),
      cipherText: 'synthetic-test-cipher',
    },
  });
  const r = await f.prepare(),
    p = await f.codes(r.id);
  expect(
    (await owner.twoFactor.findUniqueOrThrow({ where: { userId: f.uid } }))
      .secret,
  ).toBe(old);
  expect(
    await service.confirm(f.uid, f.sessionId, {
      id: p.id,
      otp: p.otp,
      totpCode: p.totpCode,
      confirmation: 'RECOVER',
    }),
  ).toEqual({ success: true });
  expect(await owner.session.count({ where: { userId: f.uid } })).toBe(0);
  expect(await owner.pushDevice.count({ where: { userId: f.uid } })).toBe(0);
  expect(
    await owner.adminAssurance.count({ where: { sessionId: f.sessionId } }),
  ).toBe(0);
  expect(
    await owner.membership.findFirst({
      where: { userId: f.uid, role: 'ADMIN' },
    }),
  ).toMatchObject({ societyId: f.societyId, active: true });
  const factor = await owner.twoFactor.findUniqueOrThrow({
    where: { userId: f.uid },
  });
  expect(await symmetricDecrypt({ key: secret, data: factor.secret })).toBe(
    p.newSecret,
  );
  expect(await owner.adminTotpUse.count({ where: { userId: f.uid } })).toBe(1);
  expect(
    await owner.operatorRecovery.findUnique({ where: { id: r.id } }),
  ).toMatchObject({
    status: 'COMPLETED',
    otpHash: null,
    encryptedSecret: null,
  });
  expect(
    await owner.registryAudit.findFirst({ where: { requestId: r.id } }),
  ).toMatchObject({
    action: 'OPERATOR_RESET_AUTHENTICATOR',
    societyId: f.societyId,
  });
});
it('allows at most one concurrent restoration and never replaces an existing admin', async () => {
  const one = await fixture(),
    two = await fixture(false, one.societyId),
    r1 = await one.prepare(),
    r2 = await two.prepare(),
    p1 = await one.codes(r1.id),
    p2 = await two.codes(r2.id);
  const results = await Promise.allSettled(
    [
      [one, p1],
      [two, p2],
    ].map(async ([f, p]) => {
      const target = f as typeof one,
        proof = p as typeof p1;
      return service.confirm(target.uid, target.sessionId, {
        id: proof.id,
        otp: proof.otp,
        totpCode: proof.totpCode,
        confirmation: 'RECOVER',
      });
    }),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(
    await owner.membership.count({
      where: { societyId: one.societyId, role: 'ADMIN', active: true },
    }),
  ).toBe(1);
});
it('cancels and wipes pending recovery on email change or deletion, and prunes expired payloads', async () => {
  for (const action of ['email', 'deletion', 'expiry']) {
    const f = await fixture(),
      r = await f.prepare();
    if (action === 'email')
      await owner.user.update({
        where: { id: f.uid },
        data: { email: `changed-${f.email}` },
      });
    if (action === 'deletion')
      await owner.user.update({
        where: { id: f.uid },
        data: { deletionRequestedAt: new Date() },
      });
    if (action === 'expiry') {
      await owner.operatorRecovery.update({
        where: { id: r.id },
        data: { expiresAt: new Date(0) },
      });
      await worker.$executeRaw`SELECT portl_auth.cleanup_account_metadata()`;
    }
    expect(
      await owner.operatorRecovery.findUnique({ where: { id: r.id } }),
    ).toMatchObject({
      status: 'CANCELLED',
      otpHash: null,
      encryptedSecret: null,
      expectedFactorHash: null,
    });
    await owner.user.delete({ where: { id: f.uid } });
    expect(await owner.operatorRecovery.count({ where: { id: r.id } })).toBe(0);
  }
});
it('isolates recovery email proofs from other users and operations', () => {
  expect(
    recoveryEmailProof(secret, 'case', 'user', 'a@example.invalid', '123456'),
  ).not.toBe(
    recoveryEmailProof(secret, 'case', 'other', 'a@example.invalid', '123456'),
  );
  expect(
    recoveryEmailProof(secret, 'case', 'user', 'a@example.invalid', '123456'),
  ).not.toBe(
    recoveryEmailProof(
      secret,
      'other-case',
      'user',
      'a@example.invalid',
      '123456',
    ),
  );
});
it.each(['request', 'session'])(
  'rechecks %s expiry after waiting for the society authority lock',
  async (deadline) => {
    const f = await fixture(),
      r = await f.prepare(),
      p = await f.codes(r.id);
    let release!: () => void, ready!: () => void;
    const released = new Promise<void>((resolve) => {
        release = resolve;
      }),
      locked = new Promise<void>((resolve) => {
        ready = resolve;
      });
    const blocker = owner.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM portl_registry."Society" WHERE id=${f.societyId} FOR UPDATE`;
        ready();
        await released;
      },
      { timeout: 20000 },
    );
    await locked;
    const expiresAt = new Date(Date.now() + 5000);
    if (deadline === 'request')
      await owner.operatorRecovery.update({
        where: { id: r.id },
        data: { expiresAt },
      });
    else
      await owner.session.update({
        where: { id: f.sessionId },
        data: { expiresAt },
      });
    const confirmation = service
      .confirm(f.uid, f.sessionId, {
        id: p.id,
        otp: p.otp,
        totpCode: p.totpCode,
        confirmation: 'RECOVER',
      })
      .then(
        (value) => ({ ok: true, value }),
        () => ({ ok: false }),
      );
    try {
      let waiting = false;
      for (let i = 0; i < 30 && !waiting; i++) {
        const [row] = await owner.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT portl_auth.complete_admin_recovery%') AS waiting`;
        waiting = !!row?.waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(waiting).toBe(true);
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, expiresAt.getTime() - Date.now() + 100),
        ),
      );
    } finally {
      release();
      await blocker;
    }
    expect(await confirmation).toEqual({ ok: false });
    expect(
      await owner.membership.count({ where: { userId: f.uid, role: 'ADMIN' } }),
    ).toBe(0);
    expect(await owner.twoFactor.count({ where: { userId: f.uid } })).toBe(0);
    expect(
      await owner.session.findUnique({ where: { id: f.sessionId } }),
    ).not.toBeNull();
  },
  30000,
);
it('enforces protected HTTP boundaries and requires fresh sign-in and a new TOTP after recovery', async () => {
  const f = await fixture(true);
  let loginCode = '';
  const clientIp = `198.19.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
  const auth = createAuth(
    db,
    {
      DATABASE_URL: url!,
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: 'http://localhost:3000',
      TRUSTED_ORIGINS: ['portl://'],
      RESEND_API_KEY: 'unused-test-provider',
      EMAIL_FROM: 'Portl <auth@example.invalid>',
    },
    async (message) => {
      loginCode = message.otp;
    },
  );
  const app = createApp(undefined, {
    auth,
    db,
    baseURL: 'http://localhost:3000',
    passCodes: passCodes(secret),
  });
  const call = (path: string, body: Record<string, unknown>, cookie?: string) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: 'POST',
        headers: {
          origin: 'portl://',
          'content-type': 'application/json',
          'x-portl-client-ip': clientIp,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const login = async () => {
    await owner.otpThrottle.deleteMany({
      where: { key: emailThrottleKey(secret, f.email, 'cooldown') },
    });
    expect(
      (
        await call('/email-otp/send-verification-otp', {
          email: f.email,
          type: 'sign-in',
        })
      ).status,
    ).toBe(200);
    const response = await call('/sign-in/email-otp', {
      email: f.email,
      otp: loginCode,
      policyAcceptance: {
        adult: true,
        termsVersion: POLICY_VERSION,
        privacyVersion: POLICY_VERSION,
      },
    });
    expect(response.status).toBe(200);
    return response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
  };
  try {
    const cookie = await login(),
      r = await f.prepare(),
      p = await f.codes(r.id);
    expect((await request(app).get('/v1/account/recovery')).status).toBe(401);
    expect(
      (await request(app).get('/v1/account/recovery').set('cookie', cookie))
        .status,
    ).toBe(409);
    const preview = await request(app)
      .get('/v1/account/recovery')
      .set('cookie', cookie)
      .set('x-portl-expected-user', f.uid);
    expect(preview.status).toBe(200);
    expect(preview.body.request.id).toBe(r.id);
    expect(preview.text).not.toContain('encryptedSecret');
    expect(preview.text).not.toContain('otpHash');
    expect(
      (
        await request(app)
          .post('/v1/account/recovery/enroll')
          .set('cookie', cookie)
          .set('x-portl-expected-user', f.uid)
          .set('origin', 'https://evil.invalid')
          .send({ id: r.id })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/v1/account/recovery/prepare')
          .set('cookie', cookie)
          .set('x-portl-expected-user', f.uid)
          .set('origin', 'portl://')
          .send(f.input)
      ).status,
    ).toBe(404);
    const result = await request(app)
      .post('/v1/account/recovery/confirm')
      .set('cookie', cookie)
      .set('x-portl-expected-user', f.uid)
      .set('origin', 'portl://')
      .send({
        id: p.id,
        otp: p.otp,
        totpCode: p.totpCode,
        confirmation: 'RECOVER',
      });
    expect(result.status).toBe(200);
    expect(
      await auth.api.getSession({ headers: new Headers({ cookie }) }),
    ).toBeNull();
    const freshCookie = await login();
    expect(
      (await call('/two-factor/verify-totp', { code: p.totpCode }, freshCookie))
        .status,
    ).toBe(409);
    const session = await auth.accountSession({
      headers: new Headers({ cookie: freshCookie }),
    });
    expect(
      (await service.status(f.uid, session!.session.id)).completedAt,
    ).not.toBeNull();
    const oldCode = await createOTP(f.oldSecret).totp();
    if (oldCode !== p.totpCode)
      expect(
        (await call('/two-factor/verify-totp', { code: oldCode }, freshCookie))
          .ok,
      ).toBe(false);
  } finally {
    await owner.otpThrottle.deleteMany({
      where: {
        key: {
          in: ['cooldown', 'hour'].map((bucket) =>
            emailThrottleKey(secret, f.email, bucket),
          ),
        },
      },
    });
    await owner.rateLimit.deleteMany({
      where: { key: { startsWith: clientIp } },
    });
  }
}, 60000);
