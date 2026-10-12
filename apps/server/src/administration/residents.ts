import type { AdministrationQuery } from '@portl/contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { audit, type Actor } from '../registry/context.js';
import { adminWork, conflict, page, unavailable } from './context.js';
export function residentService(db: PrismaClient) {
  return {
    list: (actor: Actor, sid: string, q: AdministrationQuery) =>
      adminWork(db, actor, sid, async (tx) => {
        const rows = await tx.occupancy.findMany({
          where: {
            societyId: sid,
            endedAt: q.archived === 'true' ? { not: null } : null,
            ...(q.cursor ? { id: { gt: q.cursor } } : {}),
            OR: [
              { user: { name: { contains: q.search, mode: 'insensitive' } } },
              { user: { email: { contains: q.search, mode: 'insensitive' } } },
              { flat: { label: { contains: q.search, mode: 'insensitive' } } },
            ],
          },
          include: {
            user: { select: { id: true, name: true, email: true } },
            flat: { include: { tower: true } },
          },
          orderBy: { id: 'asc' },
          take: 21,
        });
        return page(
          rows.map((o) => ({
            id: o.id,
            userId: o.userId,
            name: o.user.name,
            email: o.user.email,
            flatId: o.flatId,
            flat: o.flat.label,
            tower: o.flat.tower.name,
            relationship: o.relationship,
            startedAt: o.startedAt.toISOString(),
            endedAt: o.endedAt?.toISOString() ?? null,
          })),
        );
      }),
    end: (actor: Actor, sid: string, id: string, expectedStartedAt: string) =>
      adminWork(db, actor, sid, async (tx) => {
        const found = await tx.occupancy.findFirst({
          where: { id, societyId: sid },
          include: { user: { select: { email: true } } },
        });
        if (!found) throw unavailable();
        // Admission consumes these rows before acquiring the person's advisory lock.
        // Follow the same order so move-out cannot deadlock with acceptance/review.
        await tx.$queryRaw`SELECT id FROM portl_registry."Invitation" WHERE "societyId"=${sid} AND email=${found.user.email} AND "acceptedAt" IS NULL AND "revokedAt" IS NULL ORDER BY id FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM portl_registry."ResidentApplication" WHERE "societyId"=${sid} AND "userId"=${found.userId} AND status='PENDING' ORDER BY id FOR UPDATE`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sid + ':' + found.userId},0))`;
        await tx.$queryRaw`SELECT id FROM portl_registry."Membership" WHERE "societyId"=${sid} AND "userId"=${found.userId} AND role='RESIDENT' FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM portl_registry."Occupancy" WHERE id=${id} AND "societyId"=${sid} FOR UPDATE`;
        const row = await tx.occupancy.findFirst({
          where: { id, societyId: sid },
        });
        if (!row) throw unavailable();
        if (row.startedAt.toISOString() !== expectedStartedAt)
          throw conflict('This residency changed. Refresh before ending it.');
        if (row.endedAt) return { success: true };
        await tx.occupancy.update({
          where: { id },
          data: { endedAt: new Date() },
        });
        if (
          !(await tx.occupancy.count({
            where: { societyId: sid, userId: row.userId, endedAt: null },
          }))
        ) {
          await tx.membership.updateMany({
            where: {
              societyId: sid,
              userId: row.userId,
              role: 'RESIDENT',
              active: true,
            },
            data: { active: false },
          });
          await tx.invitation.updateMany({
            where: {
              societyId: sid,
              email: found.user.email,
              acceptedAt: null,
              revokedAt: null,
            },
            data: { revokedAt: new Date() },
          });
          await tx.residentApplication.updateMany({
            where: { societyId: sid, userId: row.userId, status: 'PENDING' },
            data: {
              status: 'WITHDRAWN',
              decidedAt: new Date(),
              decidedBy: actor.userId,
            },
          });
        }
        await audit(tx, actor, sid, 'RESIDENCY_ENDED', id);
        return { success: true };
      }),
  };
}
