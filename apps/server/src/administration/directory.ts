import type {
  DirectoryCreate,
  DirectoryEdit,
  DirectoryQuery,
} from '@portl/contracts';
import type {
  DirectoryContact,
  DirectoryEntry,
  PrismaClient,
} from '../generated/prisma/client.js';
import {
  audit,
  DomainError,
  requireAdmin,
  scope,
  withActor,
  type Actor,
} from '../registry/context.js';
import { adminWork, conflict, page, unavailable } from './context.js';
const view = (row: DirectoryEntry & { contact: DirectoryContact | null }) => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  service: row.service,
  description: row.description,
  archived: row.archived,
  version: row.version,
  phone: row.contact?.phone ?? null,
  sharePhone: row.contact?.sharePhone ?? false,
});
export function directoryService(db: PrismaClient) {
  return {
    list: (actor: Actor, sid: string, q: DirectoryQuery) =>
      withActor(db, actor, async (tx) => {
        await scope(tx, sid);
        if (q.view === 'ADMIN') await requireAdmin(tx, actor, sid);
        else {
          const [eligibility] = await tx.$queryRaw<
            { allowed: boolean }[]
          >`SELECT portl_registry.is_current_resident(${sid}) AS allowed`;
          if (!eligibility?.allowed)
            throw new DomainError(
              403,
              'FORBIDDEN',
              'Current resident access is required',
            );
          if (q.archived === 'true')
            throw new DomainError(
              403,
              'FORBIDDEN',
              'Archived records require society admin access',
            );
        }
        const rows = await tx.directoryEntry.findMany({
          where: {
            societyId: sid,
            archived: q.view === 'ADMIN' && q.archived === 'true',
            ...(q.kind ? { kind: q.kind } : {}),
            ...(q.cursor ? { id: { gt: q.cursor } } : {}),
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { service: { contains: q.search, mode: 'insensitive' } },
            ],
          },
          include: { contact: true },
          orderBy: { id: 'asc' },
          take: 21,
        });
        // Contact RLS withholds private rows even when a resident can read the entry.
        return page(
          rows.map((row) => {
            const item = view(row);
            return q.view === 'RESIDENT' && !item.sharePhone
              ? { ...item, phone: null }
              : item;
          }),
        );
      }),
    create: (actor: Actor, sid: string, input: DirectoryCreate) =>
      adminWork(db, actor, sid, async (tx) => {
        const { phone, sharePhone, ...entry } = input;
        await tx.directoryEntry.create({
          data: {
            ...entry,
            societyId: sid,
            contact: { create: { phone, sharePhone } },
          },
        });
        await audit(tx, actor, sid, 'DIRECTORY_CREATED', input.id);
        return { success: true };
      }),
    edit: (actor: Actor, sid: string, id: string, input: DirectoryEdit) =>
      adminWork(db, actor, sid, async (tx) => {
        await tx.$queryRaw`SELECT id FROM portl_registry."DirectoryEntry" WHERE id=${id} AND "societyId"=${sid} FOR UPDATE`;
        const row = await tx.directoryEntry.findFirst({
          where: { id, societyId: sid },
        });
        if (!row) throw unavailable();
        if (row.archived || row.version !== input.expectedVersion)
          throw conflict();
        const { phone, sharePhone, name, kind, service, description } = input;
        await tx.directoryEntry.update({
          where: { id },
          data: { name, kind, service, description, version: { increment: 1 } },
        });
        await tx.directoryContact.upsert({
          where: { entryId: id },
          create: { entryId: id, societyId: sid, phone, sharePhone },
          update: { phone, sharePhone },
        });
        await audit(tx, actor, sid, 'DIRECTORY_UPDATED', id);
        return { success: true };
      }),
    archive: (actor: Actor, sid: string, id: string, expectedVersion: number) =>
      adminWork(db, actor, sid, async (tx) => {
        const changed = await tx.directoryEntry.updateMany({
          where: {
            id,
            societyId: sid,
            archived: false,
            version: expectedVersion,
          },
          data: { archived: true, version: { increment: 1 } },
        });
        if (!changed.count) throw conflict();
        await audit(tx, actor, sid, 'DIRECTORY_ARCHIVED', id);
        return { success: true };
      }),
  };
}
