import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lookupSchema, societyLookupInput } from '@portl/contracts';
import type { PortlAuth } from '../auth/auth.js';
import { createDatabase } from '../database/client.js';
import { DomainError, hash } from './context.js';
import { registryRouter } from './router.js';

const runtime = process.env.PORTL_TEST_DATABASE_URL;
const direct =
  process.env.PORTL_TEST_DIRECT_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
if (process.env.NODE_ENV !== 'test' || !runtime || !direct)
  throw new Error('Restricted test and fixture-owner URLs required');
const db = createDatabase(runtime);
const owner = createDatabase(direct);
const userId = randomUUID();
const sessionId = randomUUID();
const societyId = randomUUID();
const otherSocietyId = randomUUID();
const foreignFlatId = randomUUID();
const archivedFlatId = randomUUID();
const code = randomBytes(6).toString('hex').toUpperCase();
const expected: { id: string; tower: string; label: string }[] = [];
const auth = {
  api: {
    getSession: async () => ({
      user: {
        id: userId,
        email: `${userId}@pagination.invalid`,
        emailVerified: true,
      },
      session: { id: sessionId },
    }),
  },
  acceptsOrigin: (origin: string) => origin === 'portl://',
  budget: async () => true,
} as unknown as PortlAuth;
const app = express();
app.use('/v1', registryRouter(auth, db));
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (error instanceof DomainError)
      res.status(error.status).json({ error: { code: error.code } });
    else next(error);
  },
);
function page(kind: 'lookup' | 'admin', cursor?: string) {
  const caller = request(app);
  return kind === 'lookup'
    ? caller
        .post('/v1/onboarding/society-lookup')
        .set('expo-origin', 'portl://')
        .set('x-portl-expected-user', userId)
        .send({ code, ...(cursor ? { cursor } : {}) })
    : caller
        .get(
          `/v1/societies/${societyId}/admin/flats${cursor ? `?cursor=${cursor}` : ''}`,
        )
        .set('x-portl-expected-user', userId);
}

beforeAll(async () => {
  await owner.user.create({
    data: {
      id: userId,
      name: 'Synthetic pagination admin',
      email: `${userId}@pagination.invalid`,
      emailVerified: true,
    },
  });
  await owner.session.create({
    data: {
      id: sessionId,
      userId,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  await owner.accountPolicy.create({
    data: { userId, version: '2026-10-14', adult: true },
  });
  await owner.adminAssurance.create({
    data: { sessionId, expiresAt: new Date(Date.now() + 600000) },
  });
  await owner.society.create({
    data: {
      id: societyId,
      name: 'Pagination fixture',
      joinCodeHash: hash(code),
    },
  });
  await owner.membership.create({
    data: { societyId, userId, role: 'ADMIN' },
  });
  // Reverse insertion order proves pagination follows tower/label order.
  for (const [name, count] of [
    ['Z', 2],
    ['B', 255],
    ['A', 250],
  ] as const) {
    const tower = await owner.tower.create({ data: { societyId, name } });
    const flats = Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      label: String(count - index).padStart(4, '0'),
      societyId,
      towerId: tower.id,
    }));
    await owner.flat.createMany({ data: flats });
    expected.push(
      ...flats.map((flat) => ({ id: flat.id, label: flat.label, tower: name })),
    );
    if (name === 'A')
      await owner.flat.create({
        data: {
          id: archivedFlatId,
          label: 'archived',
          societyId,
          towerId: tower.id,
          archived: true,
        },
      });
  }
  expected.sort(
    (a, b) =>
      a.tower.localeCompare(b.tower) ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id),
  );
  await owner.society.create({
    data: {
      id: otherSocietyId,
      name: 'Foreign pagination fixture',
      joinCodeHash: hash(randomUUID()),
      towers: {
        create: {
          name: 'A',
          flats: { create: { id: foreignFlatId, label: '0001' } },
        },
      },
    },
  });
});
afterAll(async () => {
  const ids = [societyId, otherSocietyId];
  await owner.membership.deleteMany({ where: { societyId: { in: ids } } });
  await owner.flat.deleteMany({ where: { societyId: { in: ids } } });
  await owner.tower.deleteMany({ where: { societyId: { in: ids } } });
  await owner.society.deleteMany({ where: { id: { in: ids } } });
  await owner.user.deleteMany({ where: { id: userId } });
  await Promise.all([db.$disconnect(), owner.$disconnect()]);
});

describe('flat selection pagination', () => {
  it('accepts bounded lookup cursors and preserves response cursors', () => {
    const cursor = randomUUID();
    expect(societyLookupInput.parse({ code, cursor })).toMatchObject({
      cursor,
    });
    expect(() =>
      societyLookupInput.parse({ code, cursor: 'invalid' }),
    ).toThrow();
    expect(
      lookupSchema.parse({
        society: { id: societyId, name: 'Fixture', isDemo: true },
        flats: [],
        nextCursor: cursor,
      }),
    ).toHaveProperty('nextCursor', cursor);
  });

  it.each(['lookup', 'admin'] as const)(
    'returns every active flat once in bounded %s pages beyond the first 500',
    async (kind) => {
      const first = await page(kind);
      expect(first.status).toBe(200);
      expect(first.body.flats).toEqual(expected.slice(0, 500));
      expect(first.body.nextCursor).toBe(expected[499]!.id);
      const second = await page(kind, first.body.nextCursor);
      expect(second.status).toBe(200);
      expect(second.body.flats).toEqual(expected.slice(500));
      expect(second.body.nextCursor).toBeNull();
      expect(
        new Set(
          [...first.body.flats, ...second.body.flats].map((flat) => flat.id),
        ).size,
      ).toBe(507);
      const exhausted = await page(kind, expected.at(-1)!.id);
      expect(exhausted.status).toBe(200);
      expect(exhausted.body).toMatchObject({ flats: [], nextCursor: null });
    },
  );

  it.each(['lookup', 'admin'] as const)(
    'rejects foreign, archived and missing cursor anchors for %s',
    async (kind) => {
      for (const cursor of [foreignFlatId, archivedFlatId, randomUUID()]) {
        const response = await page(kind, cursor);
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('INVALID_CURSOR');
      }
    },
  );
});
