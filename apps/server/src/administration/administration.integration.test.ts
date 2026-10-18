import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { createDatabase } from '../database/client.js';
import { passCodes } from '../gate/pass-codes.js';
import { hash, scope, withActor } from '../registry/context.js';

const runtime = process.env.PORTL_TEST_DATABASE_URL!;
const direct =
  process.env.PORTL_TEST_DIRECT_DATABASE_URL ||
  process.env.DIRECT_DATABASE_URL!;
const db = createDatabase(runtime),
  owner = createDatabase(direct);
const sent = new Map<string, string>(),
  prefix = randomUUID();
// Isolate this run from other suites and prior runs without relaxing auth limits.
const network = randomBytes(2);
const fixtureIp = (index: number) =>
  `10.${network[0]}.${network[1]}.${index + 1}`;
const auth = createAuth(
  db,
  {
    DATABASE_URL: runtime,
    BETTER_AUTH_SECRET: 'test-only-administration-secret-at-least-32-bytes',
    BETTER_AUTH_URL: 'http://localhost:3000',
    TRUSTED_ORIGINS: ['portl://'],
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
  passCodes: passCodes('test-only-administration-secret-at-least-32-bytes'),
});
type User = { id: string; email: string; sessionId: string; cookie: string };
const users: User[] = [],
  societies: string[] = [];
let admin: User,
  resident: User,
  guard: User,
  outsider: User,
  sid: string,
  otherSid: string,
  towerId: string,
  flatId: string,
  occupancyId: string;
async function login() {
  const email = `${prefix}-${users.length}@administration-test.invalid`;
  const call = (path: string, body: object) =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        method: 'POST',
        headers: {
          origin: 'portl://',
          'content-type': 'application/json',
          'x-portl-client-ip': fixtureIp(users.length),
        },
        body: JSON.stringify({
          ...body,
          policyAcceptance: {
            adult: true,
            termsVersion: '2026-10-18',
            privacyVersion: '2026-10-18',
          },
        }),
      }),
    );
  expect(
    (await call('/email-otp/send-verification-otp', { email, type: 'sign-in' }))
      .status,
  ).toBe(200);
  const response = await call('/sign-in/email-otp', {
    email,
    otp: sent.get(email),
  });
  expect(response.status).toBe(200);
  const { user } = await response.json();
  const session = await db.session.findFirstOrThrow({
    where: { userId: user.id },
  });
  const result = {
    id: user.id as string,
    email,
    sessionId: session.id,
    cookie: response.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; '),
  };
  users.push(result);
  return result;
}
function api(user: User, method: 'get' | 'post', path: string, body?: object) {
  const caller = request(app);
  const call = caller[method](`/v1/societies/${sid}${path}`)
    .set('cookie', user.cookie)
    .set('origin', 'portl://');
  return method === 'post' ? call.send(body || {}) : call;
}
beforeAll(async () => {
  admin = await login();
  resident = await login();
  guard = await login();
  outsider = await login();
  for (let i = 0; i < 2; i++) {
    const society = await owner.society.create({
      data: {
        name: `Synthetic administration ${prefix}`,
        joinCodeHash: hash(randomBytes(6).toString('hex')),
      },
    });
    societies.push(society.id);
  }
  [sid, otherSid] = societies as [string, string];
  const tower = await owner.tower.create({
    data: { societyId: sid, name: 'A' },
  });
  towerId = tower.id;
  const flat = await owner.flat.create({
    data: { societyId: sid, towerId, label: '101' },
  });
  flatId = flat.id;
  await owner.membership.createMany({
    data: [
      { societyId: sid, userId: admin.id, role: 'ADMIN' },
      { societyId: sid, userId: resident.id, role: 'RESIDENT' },
      { societyId: sid, userId: guard.id, role: 'GUARD' },
      { societyId: otherSid, userId: outsider.id, role: 'ADMIN' },
    ],
  });
  occupancyId = (
    await owner.occupancy.create({
      data: {
        societyId: sid,
        flatId,
        userId: resident.id,
        relationship: 'TENANT',
      },
    })
  ).id;
  await owner.adminAssurance.createMany({
    data: [
      { sessionId: admin.sessionId, expiresAt: new Date(Date.now() + 3600000) },
      {
        sessionId: outsider.sessionId,
        expiresAt: new Date(Date.now() + 3600000),
      },
    ],
  });
});
afterAll(async () => {
  const where = { societyId: { in: societies } };
  await owner.directoryEntry.deleteMany({ where });
  await owner.registryAudit.deleteMany({ where });
  await owner.invitation.deleteMany({ where });
  await owner.residentApplication.deleteMany({ where });
  await owner.occupancy.deleteMany({ where });
  await owner.membership.deleteMany({ where });
  await owner.flat.deleteMany({ where });
  await owner.tower.deleteMany({ where });
  await owner.society.deleteMany({ where: { id: { in: societies } } });
  await owner.user.deleteMany({
    where: { id: { in: users.map((u) => u.id) } },
  });
  await db.rateLimit.deleteMany({
    where: {
      key: {
        in: users.flatMap((_, i) =>
          ['/email-otp/send-verification-otp', '/sign-in/email-otp'].map(
            (path) => `${fixtureIp(i)}|${path}`,
          ),
        ),
      },
    },
  });
  await db.$disconnect();
  await owner.$disconnect();
});
it('requires current assured society-admin access and rejects session mismatch', async () => {
  for (const user of [resident, guard, outsider])
    expect((await api(user, 'get', '/administration/summary')).status).toBe(
      403,
    );
  expect((await api(admin, 'get', '/administration/summary')).status).toBe(200);
  expect(
    (
      await api(admin, 'get', '/administration/summary').set(
        'x-portl-expected-user',
        resident.id,
      )
    ).status,
  ).toBe(401);
  await owner.adminAssurance.update({
    where: { sessionId: admin.sessionId },
    data: { expiresAt: new Date(0) },
  });
  expect(
    (await api(admin, 'get', '/administration/summary')).body.error.code,
  ).toBe('ADMIN_STEP_UP_REQUIRED');
  await owner.adminAssurance.update({
    where: { sessionId: admin.sessionId },
    data: { expiresAt: new Date(Date.now() + 3600000) },
  });
});
it('creates structures, rejects case-insensitive duplicates and stale edits, and preserves occupied flats', async () => {
  const id = randomUUID();
  expect(
    (await api(admin, 'post', '/administration/towers', { id, name: 'B' }))
      .status,
  ).toBe(201);
  expect(
    (
      await api(admin, 'post', '/administration/towers', {
        id: randomUUID(),
        name: ' b ',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await api(admin, 'post', `/administration/towers/${id}/edit`, {
        name: 'North',
        expectedVersion: 1,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await api(admin, 'post', `/administration/towers/${id}/edit`, {
        name: 'Wrong',
        expectedVersion: 1,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await api(admin, 'post', `/administration/flats/${flatId}/archive`, {
        expectedVersion: 1,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await api(admin, 'post', `/administration/towers/${towerId}/archive`, {
        expectedVersion: 1,
      })
    ).status,
  ).toBe(409);
  const foreign = await owner.tower.create({
    data: { societyId: otherSid, name: 'Other' },
  });
  expect(
    (
      await api(admin, 'post', '/administration/flats', {
        id: randomUUID(),
        towerId: foreign.id,
        label: '999',
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await api(admin, 'post', '/administration/flats', {
        id: randomUUID(),
        towerId: id,
        label: '201',
      })
    ).status,
  ).toBe(201);
  const rows = (await api(admin, 'get', '/administration/flats?search=201'))
    .body.items;
  expect(rows).toHaveLength(1);
  expect(rows[0].tower).toBe('North');
  expect(
    (
      await api(admin, 'post', '/administration/towers', {
        id: randomUUID(),
        name: 'Hidden',
        societyId: otherSid,
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await api(admin, 'post', '/administration/towers', {
        id: randomUUID(),
        name: 'Bad origin',
      }).set('origin', 'https://attacker.invalid')
    ).status,
  ).toBe(403);
});
it('serializes tower archival against concurrent flat creation without active orphan flats', async () => {
  const id = randomUUID(),
    fid = randomUUID();
  expect(
    (await api(admin, 'post', '/administration/towers', { id, name: 'Race' }))
      .status,
  ).toBe(201);
  const results = await Promise.all([
    api(admin, 'post', `/administration/towers/${id}/archive`, {
      expectedVersion: 1,
    }),
    api(admin, 'post', '/administration/flats', {
      id: fid,
      towerId: id,
      label: '1',
    }),
  ]);
  expect(results.filter((r) => r.status < 300)).toHaveLength(1);
  for (const result of results)
    expect([200, 201, 404, 409]).toContain(result.status);
  const tower = await owner.tower.findUniqueOrThrow({ where: { id } });
  expect(
    await owner.flat.count({ where: { towerId: id, archived: false } }),
  ).toBe(tower.archived ? 0 : 1);
});
it('protects private contact rows, explicitly shares/revokes numbers and excludes guards and other societies', async () => {
  const id = randomUUID();
  const input = {
    id,
    name: 'Synthetic Electrician',
    kind: 'SERVICE_PROVIDER',
    service: 'Electrical',
    description: 'Weekdays',
    phone: '+919000000001',
    sharePhone: false,
  };
  const created = await api(admin, 'post', '/administration/directory', input);
  expect(created.status).toBe(201);
  const residentList = await api(resident, 'get', '/directory');
  expect(residentList.status).toBe(200);
  expect(residentList.body.items[0].phone).toBeNull();
  const contacts = await withActor(
    db,
    {
      userId: resident.id,
      email: resident.email,
      sessionId: resident.sessionId,
      requestId: 'synthetic-test',
    },
    async (tx) => {
      await scope(tx, sid);
      return tx.directoryContact.findMany({ where: { entryId: id } });
    },
  );
  expect(contacts).toEqual([]);
  const adminResident = await owner.membership.create({
    data: { societyId: sid, userId: admin.id, role: 'RESIDENT' },
  });
  const adminOccupancy = await owner.occupancy.create({
    data: { societyId: sid, flatId, userId: admin.id, relationship: 'OWNER' },
  });
  expect(
    (await api(admin, 'get', '/directory?view=RESIDENT')).body.items[0].phone,
  ).toBeNull();
  await owner.occupancy.delete({ where: { id: adminOccupancy.id } });
  await owner.membership.delete({ where: { id: adminResident.id } });
  expect(
    (await api(admin, 'get', '/directory?view=ADMIN')).body.items[0].phone,
  ).toBe(input.phone);
  for (const user of [guard, outsider])
    expect((await api(user, 'get', '/directory')).status).toBe(403);
  expect((await api(resident, 'get', '/directory?view=ADMIN')).status).toBe(
    403,
  );
  const fields = {
    name: input.name,
    kind: input.kind,
    service: input.service,
    description: input.description,
    phone: input.phone,
    sharePhone: input.sharePhone,
  };
  expect(
    (
      await api(admin, 'post', `/administration/directory/${id}/edit`, {
        ...fields,
        sharePhone: true,
        expectedVersion: 1,
      })
    ).status,
  ).toBe(200);
  expect((await api(resident, 'get', '/directory')).body.items[0].phone).toBe(
    input.phone,
  );
  expect(
    (
      await api(admin, 'post', `/administration/directory/${id}/edit`, {
        ...fields,
        expectedVersion: 1,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await api(admin, 'post', `/administration/directory/${id}/edit`, {
        ...fields,
        expectedVersion: 2,
      })
    ).status,
  ).toBe(200);
  expect(
    (await api(resident, 'get', '/directory')).body.items[0].phone,
  ).toBeNull();
  expect(
    (
      await api(admin, 'post', `/administration/directory/${id}/archive`, {
        expectedVersion: 3,
      })
    ).status,
  ).toBe(200);
  expect((await api(resident, 'get', '/directory')).body.items).toHaveLength(0);
  expect((await api(resident, 'get', '/directory?archived=true')).status).toBe(
    403,
  );
  expect(
    (await api(admin, 'get', '/directory?view=ADMIN&archived=true')).body.items,
  ).toHaveLength(1);
});
it('paginates and searches without exporting private directory contact fields', async () => {
  await owner.directoryEntry.createMany({
    data: Array.from({ length: 22 }, (_, i) => ({
      societyId: sid,
      name: `Synthetic staff ${i}`,
      kind: 'STAFF',
      service: 'Maintenance',
    })),
  });
  const first = await api(resident, 'get', '/directory?kind=STAFF');
  expect(first.body.items).toHaveLength(20);
  expect(first.body.nextCursor).toBeTruthy();
  const second = await api(
    resident,
    'get',
    `/directory?kind=STAFF&cursor=${first.body.nextCursor}`,
  );
  expect(second.body.items).toHaveLength(2);
  expect(second.body.nextCursor).toBeNull();
  const ids = [...first.body.items, ...second.body.items].map(
    (r: { id: string }) => r.id,
  );
  expect(new Set(ids).size).toBe(22);
  expect(
    (await api(resident, 'get', '/directory?kind=STAFF&search=staff%2021')).body
      .items,
  ).toHaveLength(1);
  expect(
    (await api(admin, 'get', '/administration/towers?search=' + 'a'.repeat(81)))
      .status,
  ).toBe(422);
});
it('ends only the selected residency, rejects a stale episode and revokes resident authority after the last flat', async () => {
  const second = await owner.flat.create({
    data: { societyId: sid, towerId, label: '102' },
  });
  const secondOccupancy = await owner.occupancy.create({
    data: {
      societyId: sid,
      flatId: second.id,
      userId: resident.id,
      relationship: 'OWNER',
    },
  });
  await owner.membership.create({
    data: { societyId: otherSid, userId: resident.id, role: 'RESIDENT' },
  });
  const initial = await owner.occupancy.findUniqueOrThrow({
    where: { id: occupancyId },
  });
  expect(
    (
      await api(
        admin,
        'post',
        `/administration/occupancies/${occupancyId}/end`,
        { expectedStartedAt: new Date(0).toISOString() },
      )
    ).status,
  ).toBe(409);
  const path = `/administration/occupancies/${occupancyId}/end`,
    body = { expectedStartedAt: initial.startedAt.toISOString() };
  expect((await api(admin, 'post', path, body)).status).toBe(200);
  expect((await api(admin, 'post', path, body)).status).toBe(200);
  expect((await api(resident, 'get', '/directory')).status).toBe(200);
  const invitationId = randomUUID();
  await owner.invitation.create({
    data: {
      id: invitationId,
      societyId: sid,
      flatId: second.id,
      email: resident.email,
      relationship: 'OWNER',
      tokenHash: hash(randomUUID()),
      createdBy: admin.id,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  expect(
    (
      await api(
        admin,
        'post',
        `/administration/occupancies/${secondOccupancy.id}/end`,
        { expectedStartedAt: secondOccupancy.startedAt.toISOString() },
      )
    ).status,
  ).toBe(200);
  expect((await api(resident, 'get', '/directory')).status).toBe(403);
  expect(
    (
      await owner.membership.findFirstOrThrow({
        where: { societyId: sid, userId: resident.id, role: 'RESIDENT' },
      })
    ).active,
  ).toBe(false);
  expect(
    (
      await owner.membership.findFirstOrThrow({
        where: { societyId: otherSid, userId: resident.id, role: 'RESIDENT' },
      })
    ).active,
  ).toBe(true);
  expect(
    (await owner.invitation.findUniqueOrThrow({ where: { id: invitationId } }))
      .revokedAt,
  ).not.toBeNull();
  expect(
    (await owner.occupancy.findUniqueOrThrow({ where: { id: occupancyId } }))
      .endedAt,
  ).not.toBeNull();
  expect(
    await owner.registryAudit.count({
      where: { societyId: sid, action: 'RESIDENCY_ENDED' },
    }),
  ).toBe(2);
  expect(
    (
      await api(admin, 'post', `/administration/flats/${flatId}/archive`, {
        expectedVersion: 1,
      })
    ).status,
  ).toBe(200);
  expect(
    (await api(admin, 'get', '/administration/summary')).body.residents,
  ).toBe(0);
});
