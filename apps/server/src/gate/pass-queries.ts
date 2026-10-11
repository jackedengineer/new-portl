import type { GateView, GuestPass, GuestPassFilter } from '@portl/contracts';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import {
  DomainError,
  withActor,
  type Actor,
  type Tx,
} from '../registry/context.js';
import { flatView } from '../registry/projections.js';
import { now, requireView } from './access.js';
import { isIssuer, issuerCurrent, passMissing } from './pass-access.js';
import type { PassCodes } from './pass-codes.js';
import { passStatus } from './pass-state.js';
export const passInclude = {
  flat: { include: { tower: true } },
  visit: {
    include: {
      events: {
        include: { gate: true },
        orderBy: { createdAt: 'asc' as const },
      },
    },
  },
} satisfies Prisma.GuestPassInclude;
type Row = Prisma.GuestPassGetPayload<{ include: typeof passInclude }>;
export function passView(row: Row, at: Date, current: boolean): GuestPass {
  return {
    id: row.id,
    version: row.version,
    visitorName: row.visitorName,
    flat: flatView(row.flat),
    createdAt: row.createdAt.toISOString(),
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil.toISOString(),
    status: passStatus(row, at, current),
    presence: row.visit
      ? row.visit.exitedAt
        ? 'EXITED'
        : 'INSIDE'
      : 'NOT_ENTERED',
    events:
      row.visit?.events.map((e) => ({
        id: e.id,
        type: e.type,
        gate: { id: e.gate.id, name: e.gate.name },
        at: e.createdAt.toISOString(),
      })) ?? [],
  };
}
async function projection(tx: Tx, sid: string, row: Row) {
  const at = await now(tx);
  return {
    pass: passView(
      row,
      at,
      !!row.visit || (await issuerCurrent(tx, sid, row.id)),
    ),
    serverNow: at.toISOString(),
  };
}
export function passQueries(db: PrismaClient, codes: PassCodes) {
  return {
    setup: (actor: Actor, sid: string) =>
      withActor(db, actor, async (tx) => {
        await requireView(tx, actor, sid, 'RESIDENT');
        const flats = await tx.flat.findMany({
          where: {
            societyId: sid,
            archived: false,
            occupancies: { some: { userId: actor.userId, endedAt: null } },
          },
          include: { tower: true },
          orderBy: [{ tower: { name: 'asc' } }, { label: 'asc' }],
          take: 100,
        });
        return {
          flats: flats.map(flatView),
          serverNow: (await now(tx)).toISOString(),
        };
      }),
    detail: (actor: Actor, sid: string, id: string, role: GateView) =>
      withActor(db, actor, async (tx) => {
        await requireView(tx, actor, sid, role);
        if (role === 'RESIDENT' && !(await isIssuer(tx, sid, id)))
          throw passMissing();
        const row = await tx.guestPass.findFirst({
          where: {
            id,
            societyId: sid,
            ...(role === 'GUARD' ? { visit: { isNot: null } } : {}),
          },
          include: passInclude,
        });
        if (!row) throw passMissing();
        return projection(tx, sid, row);
      }),
    verify: (actor: Actor, sid: string, gateId: string, code: string) =>
      withActor(db, actor, async (tx) => {
        await requireView(tx, actor, sid, 'GUARD', gateId);
        const row = await tx.guestPass.findFirst({
          where: { societyId: sid, tokenHash: codes.digest(code) },
          include: passInclude,
        });
        if (!row) throw passMissing();
        return projection(tx, sid, row);
      }),
    reveal: (actor: Actor, sid: string, id: string) =>
      withActor(db, actor, async (tx) => {
        await requireView(tx, actor, sid, 'RESIDENT');
        if (!(await isIssuer(tx, sid, id))) throw passMissing();
        const row = await tx.guestPass.findFirst({
          where: { id, societyId: sid, issuerId: actor.userId },
          include: { visit: true },
        });
        if (!row) throw passMissing();
        const status = passStatus(
          row,
          await now(tx),
          await issuerCurrent(tx, sid, id),
        );
        if (status !== 'READY' && status !== 'SCHEDULED')
          throw new DomainError(
            409,
            'PASS_UNAVAILABLE',
            'This pass is no longer available to share',
          );
        return { code: codes.reveal(row.cipherText, [sid, id, actor.userId]) };
      }),
    list: (
      actor: Actor,
      sid: string,
      role: GateView,
      filter: GuestPassFilter,
      cursor?: string,
    ) =>
      withActor(db, actor, async (tx) => {
        await requireView(tx, actor, sid, role);
        if (role === 'GUARD' && filter === 'UPCOMING')
          throw new DomainError(
            403,
            'FORBIDDEN',
            'Verify a presented code to see an upcoming pass',
          );
        const at = await now(tx);
        const owner = role === 'RESIDENT' ? { issuerId: actor.userId } : {};
        const anchor = cursor
          ? await tx.guestPass.findFirst({
              where: {
                id: cursor,
                societyId: sid,
                ...owner,
                ...(role === 'GUARD' ? { visit: { isNot: null } } : {}),
              },
              select: { id: true, createdAt: true },
            })
          : null;
        if (cursor && !anchor) throw passMissing();
        const ids = await tx.$queryRaw<
          { id: string; current: boolean }[]
        >`SELECT p.id,portl_gate.pass_issuer_current(${sid},p.id) AS current FROM portl_gate."GuestPass" p LEFT JOIN portl_gate."Visit" v ON v."passId"=p.id AND v."societyId"=p."societyId"
    WHERE p."societyId"=${sid} AND (${role}<>'RESIDENT' OR p."issuerId"=${actor.userId})
    AND (${role}<>'GUARD' OR v.id IS NOT NULL)
    AND (${anchor?.id ?? null}::text IS NULL OR (p."createdAt",p.id)<(${anchor?.createdAt ?? at},${anchor?.id ?? ''}))
    AND (CASE ${filter} WHEN 'UPCOMING' THEN v.id IS NULL AND p."revokedAt" IS NULL AND p."validUntil">${at} AND portl_gate.pass_issuer_current(${sid},p.id)
      WHEN 'INSIDE' THEN v.id IS NOT NULL AND v."exitedAt" IS NULL
      ELSE v."exitedAt" IS NOT NULL OR (v.id IS NULL AND (p."revokedAt" IS NOT NULL OR p."validUntil"<=${at} OR NOT portl_gate.pass_issuer_current(${sid},p.id))) END)
    ORDER BY p."createdAt" DESC,p.id DESC LIMIT 21`;
        const rows = await tx.guestPass.findMany({
          where: {
            societyId: sid,
            id: { in: ids.slice(0, 20).map((r) => r.id) },
          },
          include: passInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        return {
          items: rows.map((r) =>
            passView(r, at, ids.find((i) => i.id === r.id)?.current ?? false),
          ),
          nextCursor: ids.length > 20 ? (rows.at(-1)?.id ?? null) : null,
          serverNow: at.toISOString(),
        };
      }),
  };
}
