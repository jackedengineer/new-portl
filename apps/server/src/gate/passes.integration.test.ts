import { stopNotificationQueue } from '../notifications/jobs.js';
import { passCodes } from '../gate/pass-codes.js';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { createDatabase } from '../database/client.js';
import { hash, scope, withActor } from '../registry/context.js';

const runtime = process.env.PORTL_TEST_DATABASE_URL!;
const owner = createDatabase(
  process.env.PORTL_TEST_DIRECT_DATABASE_URL ||
    process.env.DIRECT_DATABASE_URL!,
);
const db = createDatabase(runtime);
const prefix = randomUUID();
const sent = new Map<string, string>();
const auth = createAuth(
  db,
  {
    DATABASE_URL: runtime,
    BETTER_AUTH_SECRET: 'gate-test-only-secret-long-enough-for-auth',
    BETTER_AUTH_URL: 'http://localhost:3000',
    TRUSTED_ORIGINS: ['portl://'],
    RESEND_API_KEY: 'fake',
    EMAIL_FROM: 'Test <test@example.com>',
  },
  async ({ email, otp }) => {
    sent.set(email, otp);
  },
);
const app = createApp(undefined, {
  auth,
  db,
  baseURL: 'http://localhost:3000',
  passCodes: passCodes('test-only-guest-pass-secret-at-least-32-bytes'),
});
type User = { id: string; email: string; cookie: string; sessionId: string };
const users: User[] = [];
let sid: string,
  otherSid: string,
  flatId: string,
  otherFlatId: string,
  gateId: string;
let admin: User, guard: User, resident: User, household: User, outsider: User;
async function login() {
  const email = `${prefix}-${users.length}@guest-pass-test.invalid`;
  const call = (path: string, body: object) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: 'POST',
        headers: {
          origin: 'portl://',
          'content-type': 'application/json',
          'x-portl-client-ip': `198.51.100.${users.length + 1}`,
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
  const { user } = await signed.json();
  const session = await db.session.findFirstOrThrow({
    where: { userId: user.id },
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
function call(user: User, method: 'get' | 'post', path: string, body?: object) {
  const caller = request(app);
  const c = caller[method](`/v1/societies/${sid}/gate/${path}`)
    .set('cookie', user.cookie)
    .set('origin', 'portl://');
  return method === 'post' ? c.send(body || {}) : c;
}
beforeAll(async () => {
  [admin, guard, resident, household, outsider] = [
    await login(),
    await login(),
    await login(),
    await login(),
    await login(),
  ];
  const society = await owner.society.create({
    data: { name: `Gate test ${prefix}`, joinCodeHash: hash(prefix) },
  });
  sid = society.id;
  otherSid = (
    await owner.society.create({
      data: { name: `Other ${prefix}`, joinCodeHash: hash(prefix + 'other') },
    })
  ).id;
  const tower = await owner.tower.create({
    data: { societyId: sid, name: 'A' },
  });
  flatId = (
    await owner.flat.create({
      data: { societyId: sid, towerId: tower.id, label: '101' },
    })
  ).id;
  const otherTower = await owner.tower.create({
    data: { societyId: otherSid, name: 'B' },
  });
  otherFlatId = (
    await owner.flat.create({
      data: { societyId: otherSid, towerId: otherTower.id, label: '201' },
    })
  ).id;
  await owner.membership.createMany({
    data: [
      { societyId: sid, userId: admin.id, role: 'ADMIN' },
      { societyId: sid, userId: resident.id, role: 'RESIDENT' },
      { societyId: sid, userId: household.id, role: 'RESIDENT' },
    ],
  });
  await owner.occupancy.createMany({
    data: [resident, household].map((u) => ({
      societyId: sid,
      flatId,
      userId: u.id,
      relationship: 'TENANT' as const,
    })),
  });
  await owner.adminAssurance.create({
    data: {
      sessionId: admin.sessionId,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  gateId = (
    await owner.gate.create({ data: { societyId: sid, name: 'Guest gate' } })
  ).id;
  await owner.membership.create({
    data: { societyId: sid, userId: guard.id, role: 'GUARD' },
  });
  await owner.guardAssignment.create({
    data: { societyId: sid, gateId, userId: guard.id, createdBy: admin.id },
  });
}, 60000);
afterAll(async () => {
  if (sid) {
    const ids = [sid, otherSid].filter(Boolean);
    const where = { societyId: { in: ids } };
    await owner.gateCommandReceipt.deleteMany({ where });
    await owner.movementEvent.deleteMany({ where });
    await owner.visit.deleteMany({ where });
    await owner.guestPass.deleteMany({ where });
    await owner.requestRecipient.deleteMany({ where });
    await owner.visitorRequest.deleteMany({ where });
    await owner.guardAssignment.deleteMany({ where });
    await owner.gate.deleteMany({ where });
    await owner.registryAudit.deleteMany({ where });
    await owner.occupancy.deleteMany({ where });
    await owner.membership.deleteMany({ where });
    await owner.flat.deleteMany({ where });
    await owner.tower.deleteMany({ where });
    await owner.society.deleteMany({ where: { id: { in: ids } } });
  }
  await owner.user.deleteMany({
    where: { id: { in: users.map((u) => u.id) } },
  });
  await stopNotificationQueue(db);
  await db.$disconnect();
  await owner.$disconnect();
}, 60000);

beforeEach(async () => {
  for (const u of [resident, guard])
    for (const bucket of [
      'guest-pass-create',
      'guest-pass-verify',
      'gate-write',
      'gate-read',
    ]) {
      const key = createHmac(
        'sha256',
        'gate-test-only-secret-long-enough-for-auth',
      )
        .update(`${bucket}:${u.id}`)
        .digest('hex');
      await owner.otpThrottle.deleteMany({ where: { key } });
    }
});
function input(extra = {}) {
  const at = Date.now();
  return {
    intentId: randomUUID(),
    flatId,
    visitorName: 'Synthetic invited guest',
    validFrom: new Date(at - 60000).toISOString(),
    validUntil: new Date(at + 3600000).toISOString(),
    ...extra,
  };
}
async function create(extra = {}) {
  const body = input(extra),
    response = await call(resident, 'post', 'passes', body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const id = response.body.passId as string;
  const reveal = await call(resident, 'post', `passes/${id}/code`);
  expect(reveal.status).toBe(200);
  return { id, code: reveal.body.code as string, body, response };
}
const movement = (version = 1, extra = {}) => ({
  intentId: randomUUID(),
  expectedVersion: version,
  gateId,
  ...extra,
});
it('issues once, restricts the credential to the issuer and keeps it out of projections and receipts', async () => {
  const p = await create();
  expect((await call(resident, 'post', 'passes', p.body)).body).toEqual(
    p.response.body,
  );
  expect(
    (
      await call(resident, 'post', 'passes', {
        ...p.body,
        visitorName: 'Changed',
      })
    ).status,
  ).toBe(409);
  expect(
    (await call(household, 'get', `passes/${p.id}?view=RESIDENT`)).status,
  ).toBe(404);
  for (const u of [household, guard, admin])
    expect((await call(u, 'post', `passes/${p.id}/code`)).status).toBe(
      u === household ? 404 : 403,
    );
  expect((await call(guard, 'get', `passes/${p.id}?view=GUARD`)).status).toBe(
    404,
  );
  expect(
    (await call(guard, 'get', 'passes?view=GUARD&filter=UPCOMING')).status,
  ).toBe(403);
  const list = await call(
    resident,
    'get',
    'passes?view=RESIDENT&filter=UPCOMING',
  );
  expect(list.status).toBe(200);
  expect(list.body.items.some((r: { id: string }) => r.id === p.id)).toBe(true);
  const adminList = await call(
    admin,
    'get',
    'passes?view=ADMIN&filter=UPCOMING',
  );
  expect(adminList.status).toBe(200);
  for (const value of [
    list.body,
    adminList.body,
    await owner.gateCommandReceipt.findMany({ where: { resourceId: p.id } }),
    await owner.registryAudit.findMany({ where: { resourceId: p.id } }),
  ]) {
    expect(JSON.stringify(value)).not.toContain(p.code);
    expect(JSON.stringify(value)).not.toContain('cipherText');
    expect(JSON.stringify(value)).not.toContain('tokenHash');
  }
});
it('rejects wrong roles, foreign flats, invalid scheduling and extra identity fields', async () => {
  for (const u of [guard, admin, outsider])
    expect((await call(u, 'post', 'passes', input())).status).toBe(403);
  expect(
    (await call(resident, 'post', 'passes', input({ flatId: otherFlatId })))
      .status,
  ).toBe(409);
  expect(
    (await call(resident, 'post', 'passes', input({ issuerId: household.id })))
      .status,
  ).toBe(422);
  expect(
    (
      await call(
        resident,
        'post',
        'passes',
        input({
          validFrom: new Date(Date.now() + 8 * 86400000).toISOString(),
          validUntil: new Date(
            Date.now() + 8 * 86400000 + 3600000,
          ).toISOString(),
        }),
      )
    ).status,
  ).toBe(422);
});
it('verifies without consuming, requires code at entry, and records one entry and one exit with safe replay', async () => {
  const p = await create();
  const verified = await call(guard, 'post', 'passes/verify', {
    gateId,
    code: p.code,
  });
  expect(verified.status).toBe(200);
  expect(verified.body.pass.status).toBe('READY');
  expect(await owner.visit.count({ where: { passId: p.id } })).toBe(0);
  expect(
    (await call(guard, 'post', `passes/${p.id}/entry`, movement())).status,
  ).toBe(422);
  expect(
    (
      await call(
        guard,
        'post',
        `passes/${p.id}/entry`,
        movement(1, { code: '0000000000000000' }),
      )
    ).status,
  ).toBe(404);
  const entry = movement(1, { code: p.code });
  const entered = await call(guard, 'post', `passes/${p.id}/entry`, entry);
  expect(entered.status, JSON.stringify(entered.body)).toBe(200);
  expect(
    (await call(guard, 'post', `passes/${p.id}/entry`, entry)).body,
  ).toEqual(entered.body);
  expect(
    (
      await call(guard, 'post', `passes/${p.id}/entry`, {
        ...entry,
        code: '0000000000000000',
      })
    ).status,
  ).toBe(409);
  expect((await call(resident, 'post', `passes/${p.id}/code`)).status).toBe(
    409,
  );
  const exit = movement(2);
  const exited = await call(guard, 'post', `passes/${p.id}/exit`, exit);
  expect(exited.status).toBe(200);
  expect((await call(guard, 'post', `passes/${p.id}/exit`, exit)).body).toEqual(
    exited.body,
  );
  expect(
    (
      await call(
        guard,
        'post',
        `passes/${p.id}/entry`,
        movement(3, { code: p.code }),
      )
    ).status,
  ).toBe(409);
  const detail = await call(resident, 'get', `passes/${p.id}?view=RESIDENT`);
  expect(detail.body.pass.events.map((e: { type: string }) => e.type)).toEqual([
    'ENTRY',
    'EXIT',
  ]);
  expect(
    (
      await call(guard, 'get', 'passes?view=GUARD&filter=HISTORY')
    ).body.items.some((r: { id: string }) => r.id === p.id),
  ).toBe(true);
});
it('serializes competing redemption and revocation into one winning action', async () => {
  const p = await create();
  const responses = await Promise.all([
    call(guard, 'post', `passes/${p.id}/entry`, movement(1, { code: p.code })),
    call(resident, 'post', `passes/${p.id}/revoke`, {
      intentId: randomUUID(),
      expectedVersion: 1,
    }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const row = await owner.guestPass.findUniqueOrThrow({
    where: { id: p.id },
    include: { visit: true },
  });
  expect(!!row.revokedAt !== !!row.visit).toBe(true);
});
it('serializes distinct simultaneous entries and rejects stale or revoked credentials', async () => {
  const p = await create();
  const attempts = await Promise.all(
    [1, 2].map(() =>
      call(
        guard,
        'post',
        `passes/${p.id}/entry`,
        movement(1, { code: p.code }),
      ),
    ),
  );
  expect(attempts.map((r) => r.status).sort()).toEqual([200, 409]);
  const q = await create();
  const revoke = { intentId: randomUUID(), expectedVersion: 1 };
  expect(
    (await call(resident, 'post', `passes/${q.id}/revoke`, revoke)).status,
  ).toBe(200);
  expect(
    (await call(resident, 'post', `passes/${q.id}/revoke`, revoke)).status,
  ).toBe(200);
  expect(
    (
      await call(
        guard,
        'post',
        `passes/${q.id}/entry`,
        movement(2, { code: q.code }),
      )
    ).status,
  ).toBe(409);
});
it('invalidates the original occupancy period and permits exit after the issuer leaves', async () => {
  const p = await create();
  expect(
    (
      await call(
        guard,
        'post',
        `passes/${p.id}/entry`,
        movement(1, { code: p.code }),
      )
    ).status,
  ).toBe(200);
  const q = await create();
  const occupancy = await owner.occupancy.findFirstOrThrow({
    where: { societyId: sid, userId: resident.id },
  });
  await owner.occupancy.update({
    where: { id: occupancy.id },
    data: { endedAt: new Date() },
  });
  try {
    expect(
      (
        await call(
          guard,
          'post',
          `passes/${q.id}/entry`,
          movement(1, { code: q.code }),
        )
      ).status,
    ).toBe(409);
    expect(
      (await call(guard, 'post', `passes/${p.id}/exit`, movement(2))).status,
    ).toBe(200);
    expect(
      (await call(resident, 'get', `passes/${q.id}?view=RESIDENT`)).status,
    ).toBe(404);
    await owner.occupancy.update({
      where: { id: occupancy.id },
      data: {
        endedAt: null,
        startedAt: new Date(occupancy.startedAt.getTime() + 1),
      },
    });
    expect(
      (
        await call(
          guard,
          'post',
          `passes/${q.id}/entry`,
          movement(1, { code: q.code }),
        )
      ).status,
    ).toBe(409);
  } finally {
    await owner.occupancy.update({
      where: { id: occupancy.id },
      data: { endedAt: null, startedAt: occupancy.startedAt },
    });
  }
});
it('denies unassigned gates, foreign society access, raw unscoped reads and writable lock policies', async () => {
  const p = await create();
  const otherGate = await owner.gate.create({
    data: { societyId: sid, name: 'Unassigned guest gate' },
  });
  expect(
    (
      await call(guard, 'post', 'passes/verify', {
        gateId: otherGate.id,
        code: p.code,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .post(`/v1/societies/${otherSid}/gate/passes/verify`)
        .set('cookie', guard.cookie)
        .set('origin', 'portl://')
        .send({ gateId, code: p.code })
    ).status,
  ).toBe(403);
  expect(await db.guestPass.findMany()).toEqual([]);
  const actor = {
    userId: resident.id,
    email: resident.email,
    sessionId: resident.sessionId,
    requestId: randomUUID(),
  };
  await expect(
    withActor(db, actor, async (tx) => {
      await scope(tx, sid);
      await tx.flat.update({ where: { id: flatId }, data: { archived: true } });
    }),
  ).rejects.toThrow();
  await expect(
    withActor(db, actor, async (tx) => {
      await scope(tx, sid);
      await tx.guestPass.update({
        where: { id: p.id },
        data: { version: { increment: 1 } },
      });
    }),
  ).rejects.toThrow();
});
it('rechecks expiry after waiting for an authority lock', async () => {
  const p = await create();
  const [clock] = await owner.$queryRaw<
    { until: Date }[]
  >`SELECT clock_timestamp()+interval '8 seconds' AS until`;
  const seeded = await owner.guestPass.delete({ where: { id: p.id } });
  await owner.guestPass.create({
    data: {
      ...seeded,
      validFrom: new Date(clock!.until.getTime() - 3600000),
      validUntil: clock!.until,
    },
  });
  let pending!: Promise<{ status: number }>;
  await owner.$transaction(
    async (tx) => {
      const [blocker] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM portl_registry."Flat" WHERE id=${flatId} FOR UPDATE`;
      pending = call(
        guard,
        'post',
        `passes/${p.id}/entry`,
        movement(1, { code: p.code }),
      ).then((r) => r);
      await expect
        .poll(
          async () => {
            const [r] = await tx.$queryRaw<
              { blocked: boolean }[]
            >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pg_blocking_pids(pid) @> ARRAY[${blocker!.pid}]::int[]) AND clock_timestamp()<${clock!.until} AS blocked`;
            return r!.blocked;
          },
          { timeout: 5000, interval: 100 },
        )
        .toBe(true);
      await tx.$executeRaw`SELECT pg_sleep(GREATEST(EXTRACT(EPOCH FROM (${clock!.until}::timestamptz-clock_timestamp())),0)+0.05)`;
    },
    { timeout: 20000 },
  );
  expect((await pending).status).toBe(409);
  expect(await owner.visit.count({ where: { passId: p.id } })).toBe(0);
});
it('blocks scheduled and expired passes, keeps existing presence after flat archival, and requires admin assurance', async () => {
  const future = await create({
    validFrom: new Date(Date.now() + 3600000).toISOString(),
    validUntil: new Date(Date.now() + 7200000).toISOString(),
  });
  expect(
    (await call(guard, 'post', 'passes/verify', { gateId, code: future.code }))
      .body.pass.status,
  ).toBe('SCHEDULED');
  expect(
    (
      await call(
        guard,
        'post',
        `passes/${future.id}/entry`,
        movement(1, { code: future.code }),
      )
    ).status,
  ).toBe(409);
  const expired = await create();
  const row = await owner.guestPass.delete({ where: { id: expired.id } });
  await owner.guestPass.create({
    data: {
      ...row,
      validFrom: new Date(Date.now() - 7200000),
      validUntil: new Date(Date.now() - 3600000),
    },
  });
  expect(
    (
      await call(
        guard,
        'post',
        `passes/${expired.id}/entry`,
        movement(1, { code: expired.code }),
      )
    ).status,
  ).toBe(409);
  const inside = await create();
  expect(
    (
      await call(
        guard,
        'post',
        `passes/${inside.id}/entry`,
        movement(1, { code: inside.code }),
      )
    ).status,
  ).toBe(200);
  const waiting = await create();
  await owner.flat.update({ where: { id: flatId }, data: { archived: true } });
  try {
    expect(
      (
        await call(
          guard,
          'post',
          `passes/${waiting.id}/entry`,
          movement(1, { code: waiting.code }),
        )
      ).status,
    ).toBe(409);
    expect(
      (await call(guard, 'post', `passes/${inside.id}/exit`, movement(2)))
        .status,
    ).toBe(200);
  } finally {
    await owner.flat.update({
      where: { id: flatId },
      data: { archived: false },
    });
  }
  await owner.adminAssurance.update({
    where: { sessionId: admin.sessionId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  try {
    expect(
      (await call(admin, 'get', 'passes?view=ADMIN&filter=UPCOMING')).status,
    ).toBe(403);
  } finally {
    await owner.adminAssurance.update({
      where: { sessionId: admin.sessionId },
      data: { expiresAt: new Date(Date.now() + 3600000) },
    });
  }
});
it('binds a shared gate intent namespace across arrivals and passes and throttles code guesses', async () => {
  const p = await create(),
    entry = movement(1, { code: p.code });
  expect(
    (await call(guard, 'post', `passes/${p.id}/entry`, entry)).status,
  ).toBe(200);
  expect(
    (
      await call(guard, 'post', 'requests', {
        intentId: entry.intentId,
        gateId,
        flatId,
        visitorName: 'Other visitor',
        category: 'GUEST',
      })
    ).status,
  ).toBe(409);
  for (let i = 0; i < 10; i++)
    expect(
      (
        await call(guard, 'post', 'passes/verify', {
          gateId,
          code: '0000000000000000',
        })
      ).status,
    ).toBe(404);
  const limited = await call(guard, 'post', 'passes/verify', {
    gateId,
    code: p.code,
  });
  expect(limited.status).toBe(429);
  expect(limited.headers['retry-after']).toBe('60');
});
it('revokes guard authority even for receipt replay', async () => {
  const p = await create(),
    entry = movement(1, { code: p.code });
  expect(
    (await call(guard, 'post', `passes/${p.id}/entry`, entry)).status,
  ).toBe(200);
  await owner.guardAssignment.updateMany({
    where: { societyId: sid, userId: guard.id },
    data: { active: false },
  });
  expect(
    (await call(guard, 'post', `passes/${p.id}/entry`, entry)).status,
  ).toBe(403);
  expect(
    (await call(guard, 'get', 'passes?view=GUARD&filter=INSIDE')).status,
  ).toBe(403);
});
