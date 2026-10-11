import pg from 'pg';
import { assertNotificationWorker } from '../notifications/worker-access.js';
import { tokenCipher } from '../notifications/tokens.js';
import { notificationService } from '../notifications/service.js';
import { notificationQueue } from '../notifications/jobs.js';
import {
  deliverNotification,
  collectReceipt,
} from '../notifications/delivery.js';
import { stopNotificationQueue } from '../notifications/jobs.js';
import { passCodes } from '../gate/pass-codes.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { createDatabase } from '../database/client.js';
import { hash, withActor } from '../registry/context.js';

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
const cipher = tokenCipher('test-only-notification-secret-at-least-32-bytes');
const workerDb = createDatabase(process.env.WORKER_DATABASE_URL!);
const app = createApp(undefined, {
  auth,
  db,
  baseURL: 'http://localhost:3000',
  passCodes: passCodes('test-only-guest-pass-secret-at-least-32-bytes'),
  tokenCipher: cipher,
});
type User = { id: string; email: string; cookie: string; sessionId: string };
const users: User[] = [];
let sid: string, otherSid: string, flatId: string, gateId: string;
let admin: User, guard: User, resident: User, household: User, outsider: User;
async function login() {
  const email = `${prefix}-${users.length}@gate-test.invalid`;
  const call = (path: string, body: object) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: 'POST',
        headers: {
          origin: 'portl://',
          'content-type': 'application/json',
          'x-portl-client-ip': `198.51.100.${users.length + 1}`,
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
const arrival = (extra = {}) => ({
  intentId: randomUUID(),
  gateId,
  flatId,
  visitorName: 'Synthetic Guest',
  category: 'GUEST',
  ...extra,
});
async function register(extra = {}) {
  const input = arrival(extra);
  const r = await call(guard, 'post', 'requests', input);
  expect(r.status, r.body.error?.message).toBe(201);
  return { input, result: r.body };
}
async function approve(id: string, user = resident) {
  return call(user, 'post', `requests/${id}/decision`, {
    intentId: randomUUID(),
    expectedVersion: 1,
    decision: 'APPROVE',
  });
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
  await owner.flat.create({
    data: { societyId: otherSid, towerId: otherTower.id, label: '201' },
  });
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
}, 60000);
afterAll(async () => {
  if (sid) {
    const ids = [sid, otherSid].filter(Boolean);
    const where = { societyId: { in: ids } };
    await owner.gateCommandReceipt.deleteMany({ where });
    await owner.movementEvent.deleteMany({ where });
    await owner.visit.deleteMany({ where });
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
  await owner.pushDevice.deleteMany({
    where: { userId: { in: users.map((u) => u.id) } },
  });
  await workerDb.$disconnect();
  await stopNotificationQueue(db);
  await db.$disconnect();
  await owner.$disconnect();
}, 60000);
beforeAll(async () => {
  const gate = await call(admin, 'post', 'admin/gates', {
    name: 'Notification gate',
  });
  expect(gate.status).toBe(201);
  gateId = gate.body.id;
  expect(
    (
      await call(admin, 'post', 'admin/assignments', {
        gateId,
        email: guard.email,
      })
    ).status,
  ).toBe(201);
});
const asActor = (u: User) => ({
  userId: u.id,
  email: u.email,
  sessionId: u.sessionId,
  requestId: randomUUID(),
});
it('durably sends once, rechecks revoked sessions and ignores invalid receipts for rotated tokens', async () => {
  await expect(assertNotificationWorker(workerDb)).resolves.toBeUndefined();
  await expect(assertNotificationWorker(db)).rejects.toThrow('business write');
  const service = notificationService(db, cipher),
    installationId = randomUUID();
  await service.register(asActor(resident), {
    installationId,
    token: 'ExpoPushToken[synthetic-one]',
    platform: 'android',
  });
  const { result } = await register();
  const n = await owner.notification.findFirstOrThrow({
    where: {
      societyId: sid,
      resourceId: result.requestId,
      userId: resident.id,
    },
  });
  const [job] = await owner.$queryRaw<
    { id: string }[]
  >`SELECT id::text FROM portl_jobs.job WHERE data->>'notificationId'=${n.id}`;
  expect(job).toBeDefined();
  await expect(
    withActor(
      db,
      asActor(resident),
      (tx) =>
        tx.$queryRaw`SELECT * FROM portl_notifications.delivery_targets(${n.id})`,
    ),
  ).rejects.toThrow();
  await expect(
    workerDb.user.update({
      where: { id: resident.id },
      data: { name: 'Forbidden change' },
    }),
  ).rejects.toThrow();
  const session = await owner.session.findUniqueOrThrow({
    where: { id: resident.sessionId },
  });
  await owner.session.update({
    where: { id: session.id },
    data: { expiresAt: new Date(0) },
  });
  try {
    expect(
      await workerDb.$queryRaw`SELECT * FROM portl_notifications.delivery_targets(${n.id})`,
    ).toEqual([]);
  } finally {
    await owner.session.update({
      where: { id: session.id },
      data: { expiresAt: session.expiresAt },
    });
  }
  const boss = notificationQueue(workerDb);
  await boss.start();
  try {
    const provider = {
      send: vi
        .fn()
        .mockResolvedValue({ status: 'ok', ticketId: 'synthetic-ticket' }),
      receipt: vi
        .fn()
        .mockResolvedValue({ status: 'error', code: 'DeviceNotRegistered' }),
    };
    await deliverNotification(workerDb, boss, provider, cipher, n.id);
    await deliverNotification(workerDb, boss, provider, cipher, n.id);
    expect(provider.send).toHaveBeenCalledTimes(1);
    const delivery = await owner.delivery.findFirstOrThrow({
      where: { notificationId: n.id },
    });
    expect(delivery.status).toBe('ACCEPTED');
    const old = await owner.pushDevice.findUniqueOrThrow({
      where: { id: installationId },
    });
    expect(old.cipherText).not.toContain('synthetic-one');
    await service.register(asActor(resident), {
      installationId,
      token: 'ExpoPushToken[synthetic-two]',
      platform: 'android',
    });
    await collectReceipt(workerDb, provider, delivery.id);
    const fresh = await owner.pushDevice.findUniqueOrThrow({
      where: { id: installationId },
    });
    expect(fresh.generation).not.toBe(old.generation);
    expect(fresh.enabled).toBe(true);
    await approve(result.requestId);
    expect(
      await workerDb.$queryRaw`SELECT * FROM portl_notifications.delivery_targets(${n.id})`,
    ).toEqual([]);
  } finally {
    await boss.stop();
    await service.remove(asActor(resident), installationId);
  }
});
it('attempts healthy devices when another device needs a retry', async () => {
  const service = notificationService(db, cipher);
  await owner.pushDevice.deleteMany({ where: { userId: resident.id } });
  for (const label of ['rate-limited', 'healthy'])
    await service.register(asActor(resident), {
      installationId: randomUUID(),
      token: `ExpoPushToken[${label}]`,
      platform: 'android',
    });
  const { result } = await register();
  const n = await owner.notification.findFirstOrThrow({
    where: { resourceId: result.requestId, userId: resident.id },
  });
  const boss = notificationQueue(workerDb);
  await boss.start();
  try {
    const provider = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ status: 'retry', code: 'MessageRateExceeded' })
        .mockResolvedValue({ status: 'ok', ticketId: 'healthy-ticket' }),
      receipt: vi.fn(),
    };
    await expect(
      deliverNotification(workerDb, boss, provider, cipher, n.id),
    ).rejects.toThrow('RETRY');
    expect(provider.send).toHaveBeenCalledTimes(2);
    expect(
      await owner.delivery.count({
        where: { notificationId: n.id, status: 'ACCEPTED' },
      }),
    ).toBe(1);
    await deliverNotification(workerDb, boss, provider, cipher, n.id);
    expect(provider.send).toHaveBeenCalledTimes(3);
    expect(
      await owner.delivery.count({
        where: { notificationId: n.id, status: 'ACCEPTED' },
      }),
    ).toBe(2);
  } finally {
    await boss.stop();
    await owner.pushDevice.deleteMany({ where: { userId: resident.id } });
  }
});
it('rolls back the source change and notification when queue insertion fails', async () => {
  const role = pg.escapeIdentifier(
    decodeURIComponent(new URL(runtime).username),
  );
  const before = await owner.notification.count({ where: { societyId: sid } });
  const visitorName = `Atomic rollback ${randomUUID()}`;
  await owner.$executeRawUnsafe(
    `REVOKE INSERT ON portl_jobs.job_common FROM ${role}`,
  );
  try {
    const response = await call(
      guard,
      'post',
      'requests',
      arrival({ visitorName }),
    );
    expect(response.status).toBe(500);
    expect(
      await owner.visitorRequest.count({
        where: { societyId: sid, visitorName },
      }),
    ).toBe(0);
    expect(await owner.notification.count({ where: { societyId: sid } })).toBe(
      before,
    );
  } finally {
    await owner.$executeRawUnsafe(
      `GRANT INSERT ON portl_jobs.job_common TO ${role}`,
    );
  }
});
it('does not restore old guard alerts after a gate assignment is reactivated', async () => {
  const { result } = await register();
  await approve(result.requestId);
  const n = await owner.notification.findFirstOrThrow({
    where: { userId: guard.id, resourceId: result.requestId },
  });
  const assignment = await owner.guardAssignment.findFirstOrThrow({
    where: { userId: guard.id, gateId, active: true },
  });
  const read = () =>
    request(app).get(`/v1/notifications/${n.id}`).set('cookie', guard.cookie);
  expect((await read()).status).toBe(200);
  await owner.guardAssignment.update({
    where: { id: assignment.id },
    data: { active: false },
  });
  expect((await read()).status).toBe(404);
  await owner.guardAssignment.update({
    where: { id: assignment.id },
    data: { active: true },
  });
  expect((await read()).status).toBe(404);
});
it('requires a session, trusted mutation origin and the expected account', async () => {
  expect((await request(app).get('/v1/notifications')).status).toBe(401);
  expect(
    (
      await request(app)
        .get('/v1/notifications')
        .set('cookie', resident.cookie)
        .set('x-portl-expected-user', guard.id)
    ).status,
  ).toBe(401);
  expect(
    (
      await request(app)
        .post('/v1/notifications/devices/remove')
        .set('cookie', resident.cookie)
        .set('origin', 'https://untrusted.invalid')
        .send({ installationId: randomUUID() })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app)
        .post('/v1/notifications/devices/register')
        .set('cookie', resident.cookie)
        .set('origin', 'portl://')
        .send({
          installationId: randomUUID(),
          token: 'ExpoPushToken[test]',
          platform: 'android',
          userId: guard.id,
        })
    ).status,
  ).toBe(422);
});
it('serializes device caps, including reactivation, and rejects token ownership conflicts', async () => {
  const service = notificationService(db, cipher);
  await owner.pushDevice.deleteMany({ where: { userId: resident.id } });
  const inputs = Array.from({ length: 6 }, () => ({
    installationId: randomUUID(),
    token: `ExpoPushToken[${randomUUID()}]`,
    platform: 'android' as const,
  }));
  const registered = await Promise.allSettled(
    inputs.map((input) => service.register(asActor(resident), input)),
  );
  expect(registered.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
  const first = inputs[registered.findIndex((r) => r.status === 'fulfilled')]!;
  await expect(
    service.register(asActor(guard), {
      ...first,
      installationId: randomUUID(),
    }),
  ).rejects.toThrow();
  await service.remove(asActor(resident), first.installationId);
  const replacement = {
    installationId: randomUUID(),
    token: `ExpoPushToken[${randomUUID()}]`,
    platform: 'android' as const,
  };
  await service.register(asActor(resident), replacement);
  await expect(service.register(asActor(resident), first)).rejects.toThrow();
  await owner.pushDevice.deleteMany({ where: { userId: resident.id } });
});
it('publishes a private, deduplicated inbox and hides it after occupancy revocation', async () => {
  const { input, result } = await register();
  await call(guard, 'post', 'requests', input);
  const inbox = (u: User) =>
    request(app).get('/v1/notifications').set('cookie', u.cookie);
  const r = await inbox(resident);
  expect(r.status).toBe(200);
  const matches = r.body.items.filter(
    (n: { resourceId: string }) => n.resourceId === result.requestId,
  );
  expect(matches).toHaveLength(1);
  const n = matches[0];
  expect(n.type).toBe('VISITOR_REQUESTED');
  expect(JSON.stringify(n)).not.toContain('Synthetic Guest');
  expect(
    (
      await request(app)
        .get(`/v1/notifications/${n.id}`)
        .set('cookie', outsider.cookie)
    ).status,
  ).toBe(404);
  expect(
    (
      await request(app)
        .post(`/v1/notifications/${n.id}/read`)
        .set('cookie', resident.cookie)
        .set('origin', 'portl://')
        .send({})
    ).status,
  ).toBe(200);
  expect(
    (
      await request(app)
        .get(`/v1/notifications/${n.id}`)
        .set('cookie', resident.cookie)
    ).body.readAt,
  ).not.toBeNull();
  const occupancy = await owner.occupancy.findFirstOrThrow({
    where: { societyId: sid, userId: resident.id, endedAt: null },
  });
  await owner.occupancy.update({
    where: { id: occupancy.id },
    data: { endedAt: new Date() },
  });
  expect(
    (
      await request(app)
        .get(`/v1/notifications/${n.id}`)
        .set('cookie', resident.cookie)
    ).status,
  ).toBe(404);
  await owner.occupancy.update({
    where: { id: occupancy.id },
    data: { endedAt: null, startedAt: new Date() },
  });
  expect(
    (
      await request(app)
        .get(`/v1/notifications/${n.id}`)
        .set('cookie', resident.cookie)
    ).status,
  ).toBe(404);
});
