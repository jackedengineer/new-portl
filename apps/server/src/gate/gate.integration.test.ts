import { createServer } from 'node:http';
import { once as nodeOnce } from 'node:events';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import {
  gateSignalSchema,
  type GateSignal,
  type GateSubscription,
} from '@portl/contracts';
import { createGateSocketServer } from './live.js';
import { gateLiveAccess } from './live-access.js';
import { stopNotificationQueue } from '../notifications/jobs.js';
import { passCodes } from '../gate/pass-codes.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
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
let onGateChange: ((signal: GateSignal) => void) | undefined;
const app = createApp(undefined, {
  auth,
  db,
  baseURL: 'http://localhost:3000',
  passCodes: passCodes('test-only-guest-pass-secret-at-least-32-bytes'),
  onGateChange: (signal) => onGateChange?.(signal),
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
        body: JSON.stringify({
          ...body,
          policyAcceptance: {
            adult: true,
            termsVersion: '2026-10-14',
            privacyVersion: '2026-10-14',
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
async function detail(id: string, user = guard) {
  return call(
    user,
    'get',
    `requests/${id}?view=${user === guard ? 'GUARD' : user === admin ? 'ADMIN' : 'RESIDENT'}`,
  );
}
async function approve(id: string, user = resident) {
  return call(user, 'post', `requests/${id}/decision`, {
    intentId: randomUUID(),
    expectedVersion: 1,
    decision: 'APPROVE',
  });
}
async function seedExpired(
  status: 'PENDING' | 'APPROVED',
  inside = false,
  approvedUntil?: Date,
) {
  const at = new Date(Date.now() - 3600000);
  const row = await owner.visitorRequest.create({
    data: {
      societyId: sid,
      gateId,
      flatId,
      visitorName: 'Expired synthetic visitor',
      category: 'GUEST',
      createdBy: guard.id,
      createdAt: at,
      expiresAt: new Date(at.getTime() + 600000),
      status,
      version: inside ? 3 : status === 'APPROVED' ? 2 : 1,
      approvedUntil:
        status === 'APPROVED'
          ? approvedUntil || new Date(at.getTime() + 1800000)
          : null,
      decidedBy: status === 'APPROVED' ? household.id : null,
      decidedAt: status === 'APPROVED' ? at : null,
    },
  });
  const occupancies = await owner.occupancy.findMany({
    where: { societyId: sid, flatId, endedAt: null },
  });
  await owner.requestRecipient.createMany({
    data: occupancies.map((o) => ({
      societyId: sid,
      requestId: row.id,
      userId: o.userId,
      occupancyId: o.id,
      occupancyStartedAt: o.startedAt,
    })),
  });
  if (inside) {
    const visit = await owner.visit.create({
      data: {
        societyId: sid,
        requestId: row.id,
        enteredAt: at,
        enteredBy: guard.id,
      },
    });
    await owner.movementEvent.create({
      data: {
        societyId: sid,
        visitId: visit.id,
        gateId,
        actorId: guard.id,
        type: 'ENTRY',
        createdAt: at,
      },
    });
  }
  return row.id;
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
  await stopNotificationQueue(db);
  await db.$disconnect();
  await owner.$disconnect();
}, 60000);
it('requires assured admin to create gates and grant verified guard access', async () => {
  expect(
    (await call(resident, 'post', 'admin/gates', { name: 'Main gate' })).status,
  ).toBe(403);
  const r = await call(admin, 'post', 'admin/gates', { name: 'Main gate' });
  expect(r.status).toBe(201);
  gateId = r.body.id;
  expect((await call(guard, 'get', 'setup?view=GUARD')).status).toBe(403);
  expect(
    (
      await call(admin, 'post', 'admin/assignments', {
        gateId,
        email: guard.email,
      })
    ).status,
  ).toBe(201);
  expect((await call(guard, 'get', 'setup?view=GUARD')).body.gates).toEqual([
    { id: gateId, name: 'Main gate' },
  ]);
});
function socketNext(socket: Socket, event: string) {
  return new Promise<unknown>((resolve, reject) => {
    const receive = (value: unknown) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      socket.off(event, receive);
      reject(new Error(`Missing ${event}`));
    }, 15000);
    socket.once(event, receive);
  });
}
it('delivers committed arrivals and decisions through real sockets with current session, tenant and role checks', async () => {
  const http = createServer(app),
    authorize = gateLiveAccess(auth, db);
  const live = createGateSocketServer(http, {
    authorize,
    acceptsOrigin: auth.acceptsOrigin,
    budget: (uid) => auth.budget(uid, 'gate-live-test', 20, 60),
  });
  let published = 0;
  onGateChange = (signal) => {
    published++;
    live.publish(signal);
  };
  http.listen(0, '127.0.0.1');
  await nodeOnce(http, 'listening');
  const sockets: Socket[] = [];
  const connect = (
    user: User,
    view: GateSubscription['view'],
    societyId = sid,
    userId = user.id,
  ) => {
    const socket = io(
      `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
      {
        autoConnect: false,
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: { cookie: user.cookie, 'expo-origin': 'portl://' },
        auth: { userId, societyId, view },
      },
    );
    sockets.push(socket);
    return socket;
  };
  const open = async (socket: Socket) => {
    const ready = socketNext(socket, 'connect');
    socket.connect();
    await ready;
    return socket;
  };
  try {
    const residentSocket = await open(connect(resident, 'RESIDENT'));
    const guardSocket = await open(connect(guard, 'GUARD'));
    for (const denied of [
      connect(outsider, 'RESIDENT'),
      connect(resident, 'RESIDENT', otherSid),
      connect(resident, 'RESIDENT', sid, guard.id),
      connect(guard, 'ADMIN'),
    ]) {
      const failed = socketNext(denied, 'connect_error');
      denied.connect();
      await failed;
      expect(denied.connected).toBe(false);
    }
    const incoming = socketNext(residentSocket, 'gate:changed'),
      gateIncoming = socketNext(guardSocket, 'gate:changed');
    const { result } = await register();
    const signal = gateSignalSchema.parse(await incoming);
    expect(signal).toEqual({
      societyId: sid,
      requestId: result.requestId,
      version: 1,
    });
    expect(await gateIncoming).toEqual(signal);
    expect((await detail(result.requestId, resident)).body.request.status).toBe(
      'PENDING',
    );
    const decision = socketNext(guardSocket, 'gate:changed'),
      householdDecision = socketNext(residentSocket, 'gate:changed');
    expect((await approve(result.requestId)).status).toBe(200);
    expect(await decision).toEqual({ ...signal, version: 2 });
    await householdDecision;
    expect((await detail(result.requestId)).body.request.status).toBe(
      'APPROVED',
    );
    expect((await approve(result.requestId)).status).toBe(409);
    expect(published).toBe(2);
    // A later occupancy episode must not inherit a captured request audience.
    const occupancy = await owner.occupancy.findFirstOrThrow({
      where: { societyId: sid, userId: resident.id },
    });
    await owner.occupancy.update({
      where: { id: occupancy.id },
      data: { startedAt: new Date(occupancy.startedAt.getTime() + 1) },
    });
    try {
      expect(
        await authorize(
          { cookie: resident.cookie },
          { userId: resident.id, societyId: sid, view: 'RESIDENT' },
          result.requestId,
        ),
      ).toBe(false);
    } finally {
      await owner.occupancy.update({
        where: { id: occupancy.id },
        data: { startedAt: occupancy.startedAt },
      });
    }
    const assurance = await owner.adminAssurance.findUniqueOrThrow({
      where: { sessionId: admin.sessionId },
    });
    await owner.adminAssurance.update({
      where: { sessionId: admin.sessionId },
      data: { expiresAt: new Date(0) },
    });
    try {
      await expect(
        authorize(
          { cookie: admin.cookie },
          { userId: admin.id, societyId: sid, view: 'ADMIN' },
        ),
      ).rejects.toMatchObject({ code: 'ADMIN_STEP_UP_REQUIRED' });
    } finally {
      await owner.adminAssurance.update({
        where: { sessionId: admin.sessionId },
        data: { expiresAt: assurance.expiresAt },
      });
    }
    const session = await owner.session.findUniqueOrThrow({
      where: { id: guard.sessionId },
    });
    await owner.session.update({
      where: { id: guard.sessionId },
      data: { expiresAt: new Date(0) },
    });
    try {
      const disconnected = socketNext(guardSocket, 'disconnect');
      live.publish({ ...signal, version: 2 });
      await disconnected;
      expect(guardSocket.connected).toBe(false);
    } finally {
      // Better Auth deletes expired sessions during verification. Restore only this
      // synthetic fixture so subsequent gate tests retain their original login.
      await owner.session.upsert({
        where: { id: guard.sessionId },
        create: session,
        update: { expiresAt: session.expiresAt },
      });
    }
  } finally {
    onGateChange = undefined;
    sockets.forEach((socket) => socket.disconnect());
    await live.close();
  }
}, 60000);
it('registers once on retries and delivers a private request to both current residents', async () => {
  const { input, result } = await register();
  const replay = await call(guard, 'post', 'requests', input);
  expect(replay.status).toBe(201);
  expect(replay.body).toEqual(result);
  expect(
    await owner.visitorRequest.count({ where: { id: result.requestId } }),
  ).toBe(1);
  for (const u of [resident, household]) {
    const d = await detail(result.requestId, u);
    expect(d.status).toBe(200);
    expect(d.body.request.status).toBe('PENDING');
    expect(d.body.request.presence).toBe('NOT_ENTERED');
  }
  expect((await detail(result.requestId, outsider)).status).toBe(403);
  expect(
    (
      await call(guard, 'post', 'requests', {
        ...input,
        visitorName: 'Different',
      })
    ).status,
  ).toBe(409);
  expect(
    (await call(guard, 'post', 'requests', arrival({ flatId: otherFlatId })))
      .status,
  ).toBe(404);
});
it('first household decision wins; guard cannot approve; approval does not record entry', async () => {
  const { result } = await register();
  expect((await approve(result.requestId, guard)).status).toBe(403);
  const outcomes = await Promise.all([
    approve(result.requestId, resident),
    approve(result.requestId, household),
  ]);
  expect(outcomes.map((o) => o.status).sort()).toEqual([200, 409]);
  const d = await detail(result.requestId);
  expect(d.body.request.presence).toBe('NOT_ENTERED');
  expect(d.body.request.events).toHaveLength(0);
});
it('records entry and exit once, supports retry, and prevents re-entry', async () => {
  const { result } = await register();
  expect((await approve(result.requestId)).status).toBe(200);
  const input = { intentId: randomUUID(), expectedVersion: 2, gateId };
  const entries = await Promise.all([
    call(guard, 'post', `requests/${result.requestId}/entry`, input),
    call(guard, 'post', `requests/${result.requestId}/entry`, input),
  ]);
  expect(entries.map((e) => e.status)).toEqual([200, 200]);
  expect(entries[0]!.body).toEqual(entries[1]!.body);
  const exit = await call(guard, 'post', `requests/${result.requestId}/exit`, {
    intentId: randomUUID(),
    expectedVersion: 3,
    gateId,
  });
  expect(exit.status).toBe(200);
  const d = await detail(result.requestId, resident);
  expect(d.body.request.presence).toBe('EXITED');
  expect(d.body.request.events.map((e: { type: string }) => e.type)).toEqual([
    'ENTRY',
    'EXIT',
  ]);
  expect(
    (
      await call(guard, 'post', `requests/${result.requestId}/entry`, {
        ...input,
        intentId: randomUUID(),
        expectedVersion: 4,
      })
    ).status,
  ).toBe(409);
});
it('expires pending decisions and blocks approval after a resident leaves', async () => {
  const first = await seedExpired('PENDING');
  expect((await approve(first)).status).toBe(409);
  const second = await register();
  expect((await approve(second.result.requestId)).status).toBe(200);
  await owner.occupancy.updateMany({
    where: { societyId: sid, userId: resident.id },
    data: { endedAt: new Date() },
  });
  expect((await detail(second.result.requestId, resident)).status).toBe(404);
  expect(
    (
      await call(guard, 'post', `requests/${second.result.requestId}/entry`, {
        intentId: randomUUID(),
        expectedVersion: 2,
        gateId,
      })
    ).status,
  ).toBe(409);
  await owner.occupancy.updateMany({
    where: { societyId: sid, userId: resident.id },
    data: { endedAt: null, startedAt: new Date() },
  });
  expect((await detail(second.result.requestId, resident)).status).toBe(404);
});
it('does not allow unscoped raw reads or mutation of append-only movement', async () => {
  expect(await db.visitorRequest.count()).toBe(0);
  await expect(
    withActor(
      db,
      {
        userId: guard.id,
        email: guard.email,
        sessionId: guard.sessionId,
        requestId: randomUUID(),
      },
      async (tx) => {
        await scope(tx, sid);
        await tx.$executeRaw`DELETE FROM portl_gate."MovementEvent" WHERE "societyId"=${sid}`;
      },
    ),
  ).rejects.toThrow();
});

it('rejects and cancels without admitting anyone and lists both as history', async () => {
  const rejected = await register();
  expect(
    (
      await call(
        household,
        'post',
        `requests/${rejected.result.requestId}/decision`,
        { intentId: randomUUID(), expectedVersion: 1, decision: 'REJECT' },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await call(guard, 'post', `requests/${rejected.result.requestId}/entry`, {
        intentId: randomUUID(),
        expectedVersion: 2,
        gateId,
      })
    ).status,
  ).toBe(409);
  const cancelled = await register();
  expect(
    (
      await call(
        guard,
        'post',
        `requests/${cancelled.result.requestId}/cancel`,
        { intentId: randomUUID(), expectedVersion: 1 },
      )
    ).status,
  ).toBe(200);
  expect((await approve(cancelled.result.requestId, household)).status).toBe(
    409,
  );
  const list = await call(
    household,
    'get',
    'requests?view=RESIDENT&filter=HISTORY',
  );
  expect(list.status).toBe(200);
  expect(list.body.items.map((r: { id: string }) => r.id)).toEqual(
    expect.arrayContaining([
      rejected.result.requestId,
      cancelled.result.requestId,
    ]),
  );
});
it('shows another household member’s approval, enforces approval expiry, and supports exit after the approval window', async () => {
  const current = await register();
  expect((await approve(current.result.requestId, household)).status).toBe(200);
  expect(
    (await detail(current.result.requestId, resident)).body.request.status,
  ).toBe('APPROVED');
  const expired = await seedExpired('APPROVED');
  expect(
    (
      await call(guard, 'post', `requests/${expired}/entry`, {
        intentId: randomUUID(),
        expectedVersion: 2,
        gateId,
      })
    ).status,
  ).toBe(409);
  const inside = await seedExpired('APPROVED', true);
  expect(
    (
      await call(guard, 'post', `requests/${inside}/exit`, {
        intentId: randomUUID(),
        expectedVersion: 3,
        gateId,
      })
    ).status,
  ).toBe(200);
});
it('serializes distinct competing entry commands and denies entry at an unassigned gate', async () => {
  const secondGate = await call(admin, 'post', 'admin/gates', {
    name: 'Service gate',
  });
  expect(secondGate.status).toBe(201);
  const { result } = await register();
  expect((await approve(result.requestId, household)).status).toBe(200);
  expect(
    (
      await call(guard, 'post', `requests/${result.requestId}/entry`, {
        intentId: randomUUID(),
        expectedVersion: 2,
        gateId: secondGate.body.id,
      })
    ).status,
  ).toBe(403);
  const results = await Promise.all(
    [0, 1].map(() =>
      call(guard, 'post', `requests/${result.requestId}/entry`, {
        intentId: randomUUID(),
        expectedVersion: 2,
        gateId,
      }),
    ),
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    await owner.movementEvent.count({
      where: { visit: { requestId: result.requestId }, type: 'ENTRY' },
    }),
  ).toBe(1);
});
it('protects raw resident decisions from guards and rejects foreign society reads', async () => {
  const { result } = await register();
  await expect(
    withActor(
      db,
      {
        userId: guard.id,
        email: guard.email,
        sessionId: guard.sessionId,
        requestId: randomUUID(),
      },
      async (tx) => {
        await scope(tx, sid);
        await tx.visitorRequest.update({
          where: { id: result.requestId },
          data: {
            status: 'APPROVED',
            decidedBy: guard.id,
            decidedAt: new Date(),
            approvedUntil: new Date(Date.now() + 1000),
          },
        });
      },
    ),
  ).rejects.toThrow();
  expect(
    (
      await request(app)
        .get(
          `/v1/societies/${otherSid}/gate/requests?view=GUARD&filter=WAITING`,
        )
        .set('cookie', guard.cookie)
    ).status,
  ).toBe(403);
  const invalid = await call(
    guard,
    'post',
    'requests',
    arrival({ status: 'APPROVED' }),
  );
  expect(invalid.status).toBe(422);
  expect(
    (
      await request(app)
        .post(`/v1/societies/${sid}/gate/requests`)
        .set('cookie', guard.cookie)
        .set('origin', 'https://invalid.example')
        .send(arrival())
    ).status,
  ).toBe(403);
});
it('keeps guard authority locks read-only and makes completed decisions immutable', async () => {
  const { result } = await register();
  expect((await approve(result.requestId, household)).status).toBe(200);
  const context = (user: User, work: Parameters<typeof withActor>[2]) =>
    withActor(
      db,
      {
        userId: user.id,
        email: user.email,
        sessionId: user.sessionId,
        requestId: randomUUID(),
      },
      async (tx) => {
        await scope(tx, sid);
        return work(tx);
      },
    );
  await expect(
    context(guard, (tx) =>
      tx.membership.updateMany({
        where: { societyId: sid, userId: household.id, role: 'RESIDENT' },
        data: { active: false },
      }),
    ),
  ).rejects.toThrow();
  await expect(
    context(guard, (tx) =>
      tx.occupancy.updateMany({
        where: { societyId: sid, userId: household.id },
        data: { endedAt: new Date() },
      }),
    ),
  ).rejects.toThrow();
  for (const user of [guard, household])
    await expect(
      context(user, (tx) =>
        tx.visitorRequest.update({
          where: { id: result.requestId },
          data: {
            version: { increment: 1 },
            approvedUntil: new Date(Date.now() + 86400000),
          },
        }),
      ),
    ).rejects.toThrow();
  expect(
    (
      await owner.membership.findUniqueOrThrow({
        where: {
          societyId_userId_role: {
            societyId: sid,
            userId: household.id,
            role: 'RESIDENT',
          },
        },
      })
    ).active,
  ).toBe(true);
});
it('blocks entry when the destination flat is archived after approval', async () => {
  const { result } = await register();
  expect((await approve(result.requestId, household)).status).toBe(200);
  await owner.flat.update({ where: { id: flatId }, data: { archived: true } });
  try {
    expect(
      (
        await call(guard, 'post', `requests/${result.requestId}/entry`, {
          intentId: randomUUID(),
          expectedVersion: 2,
          gateId,
        })
      ).status,
    ).toBe(409);
  } finally {
    await owner.flat.update({
      where: { id: flatId },
      data: { archived: false },
    });
  }
});
it('rejects approval that expires while entry waits for an authority lock', async () => {
  const [clock] = await owner.$queryRaw<
    { until: Date }[]
  >`SELECT clock_timestamp() + interval '10 seconds' AS until`;
  const id = await seedExpired('APPROVED', false, clock!.until);
  let pending!: Promise<{
    status: number;
    body: { error?: { code?: string } };
  }>;
  await owner.$transaction(
    async (tx) => {
      const [blocker] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM portl_registry."Flat" WHERE id=${flatId} FOR UPDATE`;
      pending = call(guard, 'post', `requests/${id}/entry`, {
        intentId: randomUUID(),
        expectedVersion: 2,
        gateId,
      }).then((r) => r);
      // Observe a real blocked command while the approval is still valid; no timing guess.
      await expect
        .poll(
          async () => {
            const [row] = await tx.$queryRaw<
              { blocked: boolean }[]
            >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pg_blocking_pids(pid) @> ARRAY[${blocker!.pid}]::int[]) AND clock_timestamp() < ${clock!.until} AS blocked`;
            return row!.blocked;
          },
          { timeout: 5000, interval: 100 },
        )
        .toBe(true);
      await tx.$executeRaw`SELECT pg_sleep(GREATEST(EXTRACT(EPOCH FROM (${clock!.until}::timestamptz - clock_timestamp())), 0) + 0.05)`;
    },
    { timeout: 20000 },
  );
  const response = await pending;
  expect(response.status).toBe(409);
  expect(response.body.error?.code).toBe('REQUEST_EXPIRED');
  expect(await owner.visit.count({ where: { requestId: id } })).toBe(0);
});
it('revokes the last assignment immediately, including receipt replay and history access', async () => {
  const { input } = await register();
  const assignment = await owner.guardAssignment.findFirstOrThrow({
    where: { societyId: sid, userId: guard.id, active: true },
  });
  expect(
    (await call(admin, 'post', `admin/assignments/${assignment.id}/revoke`))
      .status,
  ).toBe(200);
  expect((await call(guard, 'post', 'requests', input)).status).toBe(403);
  expect(
    (await call(guard, 'get', 'requests?view=GUARD&filter=HISTORY')).status,
  ).toBe(403);
  expect(
    (
      await owner.membership.findUniqueOrThrow({
        where: {
          societyId_userId_role: {
            societyId: sid,
            userId: guard.id,
            role: 'GUARD',
          },
        },
      })
    ).active,
  ).toBe(false);
});
