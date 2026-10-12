import pg from 'pg';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { postgresOptions } from '../database/connection.js';
import { assertRestrictedRuntime } from '../database/client.js';
import { assertNotificationWorker } from '../notifications/worker-access.js';
import { createApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { createDatabase } from '../database/client.js';
import { hash, withActor, scope } from '../registry/context.js';
import { passCodes } from '../gate/pass-codes.js';
import { tokenCipher } from '../notifications/tokens.js';
import { stopNotificationQueue } from '../notifications/jobs.js';
import { notificationService } from '../notifications/service.js';
const runtime = process.env.PORTL_TEST_DATABASE_URL!;
const owner = createDatabase(
  process.env.PORTL_TEST_DIRECT_DATABASE_URL ||
    process.env.DIRECT_DATABASE_URL!,
);
const db = createDatabase(runtime);
const workerDb = createDatabase(process.env.WORKER_DATABASE_URL!);
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

const app = createApp(undefined, {
  auth,
  db,
  baseURL: 'http://localhost:3000',
  passCodes: passCodes('test-only-guest-pass-secret-at-least-32-bytes'),
  tokenCipher: cipher,
});
type User = { id: string; email: string; cookie: string; sessionId: string };
const users: User[] = [];
let sid: string, otherSid: string, flatId: string;
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
  const c = caller[method](
    `/v1/societies/${sid}/notices${path.startsWith('?') ? path : path ? '/' + path : ''}`,
  )
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
    const ids = [sid, otherSid].filter(Boolean),
      where = { societyId: { in: ids } };
    if (
      (
        await owner.$queryRaw<
          { present: string | null }[]
        >`SELECT to_regclass('portl_community."Notice"')::text AS present`
      )[0]?.present
    )
      await owner.$executeRaw`DELETE FROM portl_community."Notice" WHERE "societyId" IN (${sid},${otherSid})`;
    await owner.registryAudit.deleteMany({ where });
    await owner.occupancy.deleteMany({ where });
    await owner.membership.deleteMany({ where });
    await owner.flat.deleteMany({ where });
    await owner.tower.deleteMany({ where });
    await owner.society.deleteMany({ where: { id: { in: ids } } });
  }
  await owner.pushDevice.deleteMany({
    where: { userId: { in: users.map((u) => u.id) } },
  });
  await owner.user.deleteMany({
    where: { id: { in: users.map((u) => u.id) } },
  });
  await stopNotificationQueue(db);
  await Promise.all([
    db.$disconnect(),
    owner.$disconnect(),
    workerDb.$disconnect(),
  ]);
});
beforeEach(async () => {
  // Each behavior owns a fresh account budget. Only synthetic fixture keys are reset.
  const keys = users.flatMap((u) =>
    ['notice-read', 'notice-write'].map((bucket) =>
      createHmac('sha256', 'gate-test-only-secret-long-enough-for-auth')
        .update(`${bucket}:${u.id}`)
        .digest('hex'),
    ),
  );
  await owner.otpThrottle.deleteMany({ where: { key: { in: keys } } });
});
const createInput = () => ({
  id: randomUUID(),
  title: 'Water supply update',
  body: 'Supply resumes at 6 pm.',
});
async function draft() {
  const input = createInput(),
    response = await call(admin, 'post', '', input);
  expect(response.status, response.body.error?.message).toBe(201);
  return response.body;
}
async function publish() {
  const item = await draft();
  const response = await call(admin, 'post', `${item.id}/publish`, {
    expectedVersion: item.version,
  });
  expect(response.status, response.body.error?.message).toBe(200);
  return response.body;
}
const actor = (u: User) => ({
  userId: u.id,
  email: u.email,
  sessionId: u.sessionId,
  requestId: randomUUID(),
});

it('requires verified authentication and rejects guard, outsider and resident authoring', async () => {
  expect((await request(app).get(`/v1/societies/${sid}/notices`)).status).toBe(
    401,
  );
  for (const user of [guard, outsider, resident]) {
    expect((await call(user, 'post', '', createInput())).status).toBe(403);
    expect((await call(user, 'get', '?view=ADMIN')).status).toBe(403);
  }
});
it('keeps drafts private, allows edits, publishes immutable content and archives finally', async () => {
  const item = await draft();
  expect((await call(resident, 'get', item.id)).status).toBe(404);
  const edited = await call(admin, 'post', `${item.id}/edit`, {
    expectedVersion: 1,
    title: 'Updated supply',
    body: 'At 7 pm.',
  });
  expect(edited.status).toBe(200);
  expect(edited.body.version).toBe(2);
  const pub = await call(admin, 'post', `${item.id}/publish`, {
    expectedVersion: 2,
  });
  expect(pub.body.status).toBe('PUBLISHED');
  expect((await call(resident, 'get', item.id)).body.title).toBe(
    'Updated supply',
  );
  expect(
    (
      await call(admin, 'post', `${item.id}/edit`, {
        expectedVersion: 3,
        title: 'Changed',
        body: 'No',
      })
    ).status,
  ).toBe(409);
  const archived = await call(admin, 'post', `${item.id}/archive`, {
    expectedVersion: 3,
  });
  expect(archived.body.status).toBe('ARCHIVED');
  expect((await call(resident, 'get', item.id)).status).toBe(404);
  expect((await call(admin, 'get', `${item.id}?view=ADMIN`)).body.status).toBe(
    'ARCHIVED',
  );
  expect(
    (await call(admin, 'post', `${item.id}/publish`, { expectedVersion: 4 }))
      .status,
  ).toBe(409);
});
it('makes draft creation idempotent and serializes concurrent publishing without duplicate inbox or jobs', async () => {
  const input = createInput();
  const creates = await Promise.all([
    call(admin, 'post', '', input),
    call(admin, 'post', '', input),
  ]);
  expect(creates.map((r) => r.status)).toEqual([201, 201]);
  expect(
    (await call(admin, 'post', '', { ...input, title: 'Conflicting title' }))
      .status,
  ).toBe(409);
  const results = await Promise.all([
    call(admin, 'post', `${input.id}/publish`, { expectedVersion: 1 }),
    call(admin, 'post', `${input.id}/publish`, { expectedVersion: 1 }),
  ]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  const notes = await owner.notification.findMany({
    where: { resourceId: input.id },
  });
  expect(notes.map((n) => n.userId).sort()).toEqual(
    [resident.id, household.id].sort(),
  );
  expect(
    notes.every(
      (n) => n.resourceKind === 'NOTICE' && !n.flatId && !n.occupancyId,
    ),
  ).toBe(true);
  const jobs = await owner.$queryRaw<
    { count: bigint }[]
  >`SELECT count(*) FROM portl_jobs.job WHERE name='notification.push' AND data->>'notificationId' IN (${notes[0]!.id},${notes[1]!.id})`;
  expect(Number(jobs[0]!.count)).toBe(2);
});
it('rejects stale edits instead of losing an administrator change', async () => {
  const item = await draft();
  const updates = await Promise.all(
    ['A', 'B'].map((title) =>
      call(admin, 'post', `${item.id}/edit`, {
        expectedVersion: 1,
        title,
        body: 'Body',
      }),
    ),
  );
  expect(updates.map((r) => r.status).sort()).toEqual([200, 409]);
});
it('enforces tenant and current occupancy access at both HTTP and database boundaries', async () => {
  const item = await publish();
  expect((await call(outsider, 'get', item.id)).status).toBe(403);
  expect(
    (
      await request(app)
        .get(`/v1/societies/${otherSid}/notices/${item.id}`)
        .set('cookie', resident.cookie)
    ).status,
  ).toBe(403);
  const before = await withActor(db, actor(resident), async (tx) => {
    await scope(tx, otherSid);
    return tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM portl_community."Notice" WHERE id=${item.id}`;
  });
  expect(before).toEqual([]);
  await owner.occupancy.updateMany({
    where: { societyId: sid, userId: household.id },
    data: { endedAt: new Date() },
  });
  expect((await call(household, 'get', item.id)).status).toBe(403);
  await owner.occupancy.updateMany({
    where: { societyId: sid, userId: household.id },
    data: { endedAt: null },
  });
});
it('rolls publication, inbox and audit back when queue insertion fails', async () => {
  const item = await draft();
  const client = new pg.Client(
    postgresOptions(process.env.DIRECT_DATABASE_URL!),
  );
  await client.connect();
  const role = decodeURIComponent(new URL(runtime).username),
    who = pg.escapeIdentifier(role);
  try {
    await client.query(
      `REVOKE INSERT ON portl_jobs.job,portl_jobs.job_common FROM ${who}`,
    );
    expect(
      (await call(admin, 'post', `${item.id}/publish`, { expectedVersion: 1 }))
        .status,
    ).toBe(500);
  } finally {
    await client.query(
      `GRANT INSERT ON portl_jobs.job,portl_jobs.job_common TO ${who}`,
    );
    await client.end();
  }
  expect((await call(admin, 'get', `${item.id}?view=ADMIN`)).body.status).toBe(
    'DRAFT',
  );
  expect(
    await owner.notification.count({ where: { resourceId: item.id } }),
  ).toBe(0);
  expect(
    await owner.registryAudit.count({
      where: { resourceId: item.id, action: 'NOTICE_PUBLISHED' },
    }),
  ).toBe(0);
  expect(
    (await call(admin, 'post', `${item.id}/publish`, { expectedVersion: 1 }))
      .status,
  ).toBe(200);
});
it('removes archived notices from resident inbox and worker targeting while retaining admin history', async () => {
  await notificationService(db, cipher).register(actor(resident), {
    installationId: randomUUID(),
    token: `ExpoPushToken[${randomUUID()}]`,
    platform: 'android',
  });
  const item = await publish(),
    note = await owner.notification.findFirstOrThrow({
      where: { resourceId: item.id, userId: resident.id },
    });
  expect(
    (await notificationService(db).detail(actor(resident), note.id)).resourceId,
  ).toBe(item.id);
  expect(
    (
      await workerDb.$queryRaw<
        { deviceId: string }[]
      >`SELECT * FROM portl_notifications.delivery_targets(${note.id})`
    ).length,
  ).toBe(1);
  expect(
    (await call(admin, 'post', `${item.id}/archive`, { expectedVersion: 2 }))
      .status,
  ).toBe(200);
  expect(
    (await call(admin, 'post', `${item.id}/archive`, { expectedVersion: 2 }))
      .status,
  ).toBe(200);
  await expect(
    notificationService(db).detail(actor(resident), note.id),
  ).rejects.toMatchObject({ status: 404 });
  expect(
    (await owner.notification.findUniqueOrThrow({ where: { id: note.id } }))
      .pushEligible,
  ).toBe(false);
  expect(
    await owner.$queryRaw`SELECT * FROM portl_notifications.delivery_targets(${note.id})`,
  ).toEqual([]);
});
it('does not restore captured inbox authority after membership revocation and regrant', async () => {
  const item = await publish(),
    note = await owner.notification.findFirstOrThrow({
      where: { resourceId: item.id, userId: household.id },
    });
  await owner.membership.updateMany({
    where: { societyId: sid, userId: household.id, role: 'RESIDENT' },
    data: { active: false },
  });
  await expect(
    notificationService(db).detail(actor(household), note.id),
  ).rejects.toMatchObject({ status: 404 });
  await owner.membership.updateMany({
    where: { societyId: sid, userId: household.id, role: 'RESIDENT' },
    data: { active: true },
  });
  await expect(
    notificationService(db).detail(actor(household), note.id),
  ).rejects.toMatchObject({ status: 404 });
  expect((await call(household, 'get', item.id)).status).toBe(200);
});
it('requires recent admin assurance, exact trusted origin, strict input and matching identity', async () => {
  expect(
    (
      await request(app)
        .post(`/v1/societies/${sid}/notices`)
        .set('cookie', admin.cookie)
        .set('origin', 'https://evil.invalid')
        .send(createInput())
    ).status,
  ).toBe(403);
  expect(
    (await call(admin, 'post', '', { ...createInput(), status: 'PUBLISHED' }))
      .status,
  ).toBe(422);
  expect(
    (
      await request(app)
        .post(`/v1/societies/${sid}/notices`)
        .set('cookie', admin.cookie)
        .set('origin', 'portl://')
        .set('x-portl-expected-user', resident.id)
        .send(createInput())
    ).status,
  ).toBe(401);
  await owner.adminAssurance.update({
    where: { sessionId: admin.sessionId },
    data: { expiresAt: new Date(0) },
  });
  expect((await call(admin, 'post', '', createInput())).body.error.code).toBe(
    'ADMIN_STEP_UP_REQUIRED',
  );
  await owner.adminAssurance.update({
    where: { sessionId: admin.sessionId },
    data: { expiresAt: new Date(Date.now() + 3600000) },
  });
});
it('enforces published immutability and tenant checks for direct restricted-role writes', async () => {
  const item = await publish();
  await expect(
    withActor(db, actor(admin), async (tx) => {
      await scope(tx, sid);
      await tx.$executeRaw`UPDATE portl_community."Notice" SET title='Forged',version=version+1 WHERE id=${item.id}`;
    }),
  ).rejects.toThrow();
  const changed = await withActor(db, actor(resident), async (tx) => {
    await scope(tx, sid);
    return tx.$executeRaw`UPDATE portl_community."Notice" SET status='ARCHIVED',version=version+1,"archivedAt"=now(),"updatedAt"=now() WHERE id=${item.id}`;
  });
  expect(changed).toBe(0);
});
it('pages with validated cursors and never returns drafts through a resident status filter', async () => {
  const item = await draft();
  expect(
    (await call(resident, 'get', '?view=RESIDENT&status=DRAFT')).status,
  ).toBe(422);
  expect((await call(admin, 'get', '?view=ADMIN&cursor=invalid')).status).toBe(
    422,
  );
  const result = await call(admin, 'get', '?view=ADMIN&status=DRAFT');
  expect(result.status).toBe(200);
  expect(result.body.items.some((n: { id: string }) => n.id === item.id)).toBe(
    true,
  );
  expect(result.body.items[0]).not.toHaveProperty('body');
});
it('captures each resident once across flats and never backfills later joiners on a repeated producer call', async () => {
  const tower = await owner.tower.findFirstOrThrow({
    where: { societyId: sid },
  });
  const extra = await owner.flat.create({
    data: { societyId: sid, towerId: tower.id, label: '102' },
  });
  await owner.occupancy.create({
    data: {
      societyId: sid,
      userId: resident.id,
      flatId: extra.id,
      relationship: 'TENANT',
    },
  });
  const item = await publish();
  expect(
    await owner.notification.count({
      where: { resourceId: item.id, userId: resident.id },
    }),
  ).toBe(1);
  await owner.membership.create({
    data: { societyId: sid, userId: outsider.id, role: 'RESIDENT' },
  });
  await owner.occupancy.create({
    data: {
      societyId: sid,
      userId: outsider.id,
      flatId,
      relationship: 'TENANT',
    },
  });
  expect((await call(outsider, 'get', item.id)).status).toBe(200);
  const replay = await withActor(db, actor(admin), async (tx) => {
    await scope(tx, sid);
    return tx.$queryRaw`SELECT id FROM portl_community.notify_notice(${item.id})`;
  });
  expect(replay).toEqual([]);
  expect(
    await owner.notification.count({
      where: { resourceId: item.id, userId: outsider.id },
    }),
  ).toBe(0);
  await owner.occupancy.deleteMany({
    where: { societyId: sid, userId: outsider.id },
  });
  await owner.membership.deleteMany({
    where: { societyId: sid, userId: outsider.id },
  });
});
it('pages more than 20 notices without overlap or body content', async () => {
  await owner.notice.createMany({
    data: Array.from({ length: 24 }, (_, i) => ({
      id: randomUUID(),
      societyId: sid,
      createdBy: admin.id,
      title: `Draft ${i}`,
      body: 'Fixture text',
      createdAt: new Date(Date.now() + i),
    })),
  });
  const first = await call(admin, 'get', '?view=ADMIN&status=DRAFT');
  expect(first.body.items).toHaveLength(20);
  expect(first.body.nextCursor).toBeTruthy();
  const second = await call(
    admin,
    'get',
    `?view=ADMIN&status=DRAFT&cursor=${encodeURIComponent(first.body.nextCursor)}`,
  );
  expect(second.status).toBe(200);
  expect(second.body.items.length).toBeGreaterThan(0);
  expect(
    first.body.items.some((n: { id: string }) =>
      second.body.items.some((m: { id: string }) => m.id === n.id),
    ),
  ).toBe(false);
  expect(second.body.items[0]).not.toHaveProperty('body');
});
it('enforces notice write budgets without weakening the production limit', async () => {
  const key = createHmac('sha256', 'gate-test-only-secret-long-enough-for-auth')
    .update(`notice-write:${admin.id}`)
    .digest('hex');
  await owner.otpThrottle.upsert({
    where: { key },
    create: { key, count: 30, resetAt: new Date(Date.now() + 60000) },
    update: { count: 30, resetAt: new Date(Date.now() + 60000) },
  });
  const response = await call(admin, 'post', '', createInput());
  expect(response.status).toBe(429);
  expect(response.headers['retry-after']).toBe('60');
});
it('rejects a worker accidentally granted notice column writes', async () => {
  await assertNotificationWorker(workerDb);
  const client = new pg.Client(
    postgresOptions(process.env.DIRECT_DATABASE_URL!),
  );
  await client.connect();
  const who = pg.escapeIdentifier(
    decodeURIComponent(new URL(process.env.WORKER_DATABASE_URL!).username),
  );
  try {
    await client.query(
      `GRANT UPDATE(title) ON portl_community."Notice" TO ${who}`,
    );
    await expect(assertNotificationWorker(workerDb)).rejects.toThrow(
      'business write',
    );
  } finally {
    await client.query(
      `REVOKE UPDATE(title) ON portl_community."Notice" FROM ${who}`,
    );
    await client.end();
  }
  await assertNotificationWorker(workerDb);
});
it('rejects a runtime that owns any community table', async () => {
  const client = new pg.Client(
    postgresOptions(process.env.DIRECT_DATABASE_URL!),
  );
  await client.connect();
  const who = pg.escapeIdentifier(
    decodeURIComponent(new URL(runtime).username),
  );
  const table = pg.escapeIdentifier(
    `probe_${randomUUID().replaceAll('-', '')}`,
  );
  try {
    await client.query(`GRANT CREATE ON SCHEMA portl_community TO ${who}`);
    await db.$executeRawUnsafe(
      `CREATE TABLE portl_community.${table} (id text)`,
    );
    await client.query(`REVOKE CREATE ON SCHEMA portl_community FROM ${who}`);
    await expect(assertRestrictedRuntime(db)).rejects.toThrow(
      'restricted privileges',
    );
  } finally {
    await client.query(`REVOKE CREATE ON SCHEMA portl_community FROM ${who}`);
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS portl_community.${table}`);
    await client.end();
  }
  await assertRestrictedRuntime(db);
});
