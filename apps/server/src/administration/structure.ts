import type { AdministrationQuery } from '@portl/contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { audit, type Actor, type Tx } from '../registry/context.js';
import { adminWork, conflict, page, unavailable } from './context.js';

export function structureService(db: PrismaClient) {
  return {
    towers: (actor: Actor, sid: string, q: AdministrationQuery) =>
      adminWork(db, actor, sid, async (tx) =>
        page(
          await tx.tower.findMany({
            where: {
              societyId: sid,
              archived: q.archived === 'true',
              name: { contains: q.search, mode: 'insensitive' },
              ...(q.cursor ? { id: { gt: q.cursor } } : {}),
            },
            orderBy: { id: 'asc' },
            take: 21,
          }),
        ),
      ),
    flats: (actor: Actor, sid: string, q: AdministrationQuery) =>
      adminWork(db, actor, sid, async (tx) => {
        const rows = await tx.flat.findMany({
          where: {
            societyId: sid,
            archived: q.archived === 'true',
            ...(q.cursor ? { id: { gt: q.cursor } } : {}),
            OR: [
              { label: { contains: q.search, mode: 'insensitive' } },
              { tower: { name: { contains: q.search, mode: 'insensitive' } } },
            ],
          },
          include: { tower: true },
          orderBy: { id: 'asc' },
          take: 21,
        });
        return page(
          rows.map((f) => ({
            id: f.id,
            towerId: f.towerId,
            tower: f.tower.name,
            label: f.label,
            archived: f.archived,
            version: f.version,
          })),
        );
      }),
    createTower: (
      actor: Actor,
      sid: string,
      input: { id: string; name: string },
    ) =>
      adminWork(db, actor, sid, async (tx) => {
        const row = await tx.tower.create({
          data: { ...input, societyId: sid },
        });
        await audit(tx, actor, sid, 'TOWER_CREATED', row.id);
        return { success: true };
      }),
    createFlat: (
      actor: Actor,
      sid: string,
      input: { id: string; towerId: string; label: string },
    ) =>
      adminWork(db, actor, sid, async (tx) => {
        const tower = await tx.tower.findFirst({
          where: { id: input.towerId, societyId: sid, archived: false },
        });
        if (!tower) throw unavailable();
        const row = await tx.flat.create({
          data: { ...input, societyId: sid },
        });
        await audit(tx, actor, sid, 'FLAT_CREATED', row.id);
        return { success: true };
      }),
    editTower: (
      actor: Actor,
      sid: string,
      id: string,
      input: { name: string; expectedVersion: number },
    ) =>
      adminWork(db, actor, sid, async (tx) => {
        const changed = await tx.tower.updateMany({
          where: {
            id,
            societyId: sid,
            archived: false,
            version: input.expectedVersion,
          },
          data: { name: input.name, version: { increment: 1 } },
        });
        if (!changed.count) throw conflict();
        await audit(tx, actor, sid, 'TOWER_RENAMED', id);
        return { success: true };
      }),
    editFlat: (
      actor: Actor,
      sid: string,
      id: string,
      input: { label: string; expectedVersion: number },
    ) =>
      adminWork(db, actor, sid, async (tx) => {
        const changed = await tx.flat.updateMany({
          where: {
            id,
            societyId: sid,
            archived: false,
            version: input.expectedVersion,
          },
          data: { label: input.label, version: { increment: 1 } },
        });
        if (!changed.count) throw conflict();
        await audit(tx, actor, sid, 'FLAT_RENAMED', id);
        return { success: true };
      }),
    archiveTower: (
      actor: Actor,
      sid: string,
      id: string,
      expectedVersion: number,
    ) =>
      adminWork(db, actor, sid, async (tx) => {
        await tx.$queryRaw`SELECT id FROM portl_registry."Tower" WHERE id=${id} AND "societyId"=${sid} FOR UPDATE`;
        const row = await tx.tower.findFirst({ where: { id, societyId: sid } });
        if (!row) throw unavailable();
        if (row.archived || row.version !== expectedVersion) throw conflict();
        if (
          await tx.flat.count({
            where: { societyId: sid, towerId: id, archived: false },
          })
        )
          throw conflict('Archive the tower’s active flats first.');
        await tx.tower.update({
          where: { id },
          data: { archived: true, version: { increment: 1 } },
        });
        await audit(tx, actor, sid, 'TOWER_ARCHIVED', id);
        return { success: true };
      }),
    archiveFlat: (
      actor: Actor,
      sid: string,
      id: string,
      expectedVersion: number,
    ) =>
      adminWork(db, actor, sid, async (tx) => {
        await tx.$queryRaw`SELECT id FROM portl_registry."Flat" WHERE id=${id} AND "societyId"=${sid} FOR UPDATE`;
        const row = await tx.flat.findFirst({ where: { id, societyId: sid } });
        if (!row) throw unavailable();
        if (row.archived || row.version !== expectedVersion) throw conflict();
        await checkFlatUnused(tx, sid, id);
        await tx.flat.update({
          where: { id },
          data: { archived: true, version: { increment: 1 } },
        });
        await audit(tx, actor, sid, 'FLAT_ARCHIVED', id);
        return { success: true };
      }),
  };
}
async function checkFlatUnused(tx: Tx, societyId: string, flatId: string) {
  if (await tx.occupancy.count({ where: { societyId, flatId, endedAt: null } }))
    throw conflict('End current residencies before archiving this flat.');
  if (
    await tx.invitation.count({
      where: {
        societyId,
        flatId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    })
  )
    throw conflict('Revoke active invitations before archiving this flat.');
  if (
    await tx.residentApplication.count({
      where: { societyId, flatId, status: 'PENDING' },
    })
  )
    throw conflict('Review pending applications before archiving this flat.');
}
