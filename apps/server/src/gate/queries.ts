import type { GateFilter, GateView, VisitorRequest } from '@portl/contracts';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { withActor, type Actor } from '../registry/context.js';
import { flatView } from '../registry/projections.js';
import {
  approvalCurrent,
  missing,
  now,
  recipient,
  requireView,
} from './access.js';
import { requestStatus } from './state.js';
const include = {
  flat: { include: { tower: true } },
  gate: true,
  visit: {
    include: {
      events: {
        include: { gate: true },
        orderBy: { createdAt: 'asc' as const },
      },
    },
  },
} satisfies Prisma.VisitorRequestInclude;
type Row = Prisma.VisitorRequestGetPayload<{ include: typeof include }>;
function view(row: Row, at: Date, current: boolean): VisitorRequest {
  return {
    id: row.id,
    version: row.version,
    visitorName: row.visitorName,
    category: row.category,
    company: row.company,
    flat: flatView(row.flat),
    gate: { id: row.gate.id, name: row.gate.name },
    status: requestStatus(row, at, current),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    approvedUntil: row.approvedUntil?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
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
export function gateQueries(db: PrismaClient) {
  return {
    setup: (actor: Actor, sid: string, role: GateView, search: string) =>
      withActor(db, actor, async (tx) => {
        await requireView(tx, actor, sid, role);
        const gates = await tx.gate.findMany({
          where: {
            societyId: sid,
            active: true,
            ...(role === 'GUARD'
              ? {
                  assignments: { some: { userId: actor.userId, active: true } },
                }
              : {}),
          },
          orderBy: { name: 'asc' },
          take: 100,
          select: { id: true, name: true },
        });
        const flats =
          role === 'GUARD'
            ? await tx.flat.findMany({
                where: {
                  societyId: sid,
                  archived: false,
                  OR: [
                    { label: { contains: search, mode: 'insensitive' } },
                    {
                      tower: {
                        name: { contains: search, mode: 'insensitive' },
                      },
                    },
                  ],
                },
                include: { tower: true },
                orderBy: [
                  { tower: { name: 'asc' } },
                  { label: 'asc' },
                  { id: 'asc' },
                ],
                take: 30,
              })
            : [];
        const rows =
          role === 'ADMIN'
            ? await tx.guardAssignment.findMany({
                where: { societyId: sid, active: true },
                include: { gate: true },
                orderBy: { id: 'asc' },
                take: 100,
              })
            : [];
        const users = rows.length
          ? await tx.user.findMany({
              where: { id: { in: rows.map((r) => r.userId) } },
              select: { id: true, email: true, name: true },
            })
          : [];
        return {
          gates,
          flats: flats.map(flatView),
          assignments: rows.map((r) => ({
            id: r.id,
            gate: { id: r.gate.id, name: r.gate.name },
            active: r.active,
            name: users.find((u) => u.id === r.userId)?.name ?? 'Guard',
            email: users.find((u) => u.id === r.userId)?.email ?? '',
          })),
          serverNow: (await now(tx)).toISOString(),
        };
      }),
    detail: (actor: Actor, sid: string, id: string, role: GateView) =>
      withActor(db, actor, async (tx) => {
        await requireView(tx, actor, sid, role);
        if (
          role === 'RESIDENT' &&
          !(await recipient(tx, sid, id, actor.userId))
        )
          throw missing();
        const row = await tx.visitorRequest.findFirst({
          where: { id, societyId: sid },
          include,
        });
        if (!row) throw missing();
        const at = await now(tx);
        return {
          request: view(
            row,
            at,
            row.status !== 'APPROVED' ||
              !!row.visit ||
              (await approvalCurrent(tx, sid, row.id)),
          ),
          serverNow: at.toISOString(),
        };
      }),
    list: (
      actor: Actor,
      sid: string,
      role: GateView,
      filter: GateFilter,
      cursor?: string,
    ) =>
      withActor(db, actor, async (tx) => {
        await requireView(tx, actor, sid, role);
        const at = await now(tx);
        const anchor = cursor
          ? await tx.visitorRequest.findFirst({
              where: {
                id: cursor,
                societyId: sid,
                ...(role === 'RESIDENT'
                  ? { recipients: { some: { userId: actor.userId } } }
                  : {}),
              },
              select: { id: true, createdAt: true },
            })
          : null;
        if (cursor && !anchor) throw missing();
        // Filter before LIMIT, with the same authoritative clock for the entire page.
        const ids = await tx.$queryRaw<
          { id: string; approvalCurrent: boolean }[]
        >`SELECT q.id, CASE WHEN q.status='APPROVED' AND v.id IS NULL THEN portl_gate.approval_current(${sid},q.id) ELSE true END AS "approvalCurrent" FROM portl_gate."VisitorRequest" q LEFT JOIN portl_gate."Visit" v ON v."requestId"=q.id AND v."societyId"=q."societyId"
    WHERE q."societyId"=${sid} AND (${role} <> 'RESIDENT' OR portl_gate.is_recipient(${sid},q.id,${actor.userId}))
    AND (${anchor?.id ?? null}::text IS NULL OR (q."createdAt",q.id)<(${anchor?.createdAt ?? at},${anchor?.id ?? ''}))
    AND (CASE ${filter} WHEN 'WAITING' THEN q.status='PENDING' AND q."expiresAt">${at}
      WHEN 'READY' THEN q.status='APPROVED' AND v.id IS NULL AND q."approvedUntil">${at} AND portl_gate.approval_current(${sid},q.id)
      WHEN 'INSIDE' THEN v.id IS NOT NULL AND v."exitedAt" IS NULL
      ELSE v."exitedAt" IS NOT NULL OR q.status IN ('REJECTED','CANCELLED') OR (q.status='PENDING' AND q."expiresAt"<=${at}) OR (q.status='APPROVED' AND v.id IS NULL AND (q."approvedUntil"<=${at} OR NOT portl_gate.approval_current(${sid},q.id))) END)
    ORDER BY q."createdAt" DESC,q.id DESC LIMIT 21`;
        const rows = await tx.visitorRequest.findMany({
          where: {
            societyId: sid,
            id: { in: ids.slice(0, 20).map((r) => r.id) },
          },
          include,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        return {
          items: rows.map((r) =>
            view(
              r,
              at,
              ids.find((i) => i.id === r.id)?.approvalCurrent ?? false,
            ),
          ),
          nextCursor: ids.length > 20 ? (rows.at(-1)?.id ?? null) : null,
          serverNow: at.toISOString(),
        };
      }),
  };
}
