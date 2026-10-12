import { z } from 'zod';
import type {
  noticeCreateInput,
  noticeEditInput,
  noticeListQuery,
  NoticeView,
} from '@portl/contracts';
import type { Notice, PrismaClient } from '../generated/prisma/client.js';
import {
  audit,
  DomainError,
  requireAdmin,
  scope,
  withActor,
  type Actor,
  type Tx,
} from '../registry/context.js';
import {
  enqueueNotificationBatch,
  withNotificationTransaction,
} from '../notifications/jobs.js';

const cursorSchema = z.strictObject({ at: z.iso.datetime(), id: z.uuid() });
const summary = (row: Omit<Notice, 'body'>) => ({
  id: row.id,
  societyId: row.societyId,
  title: row.title,
  status: row.status,
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  publishedAt: row.publishedAt?.toISOString() ?? null,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});
const dto = (row: Notice) => ({ ...summary(row), body: row.body });
const conflict = () =>
  new DomainError(
    409,
    'NOTICE_CONFLICT',
    'This notice changed. Refresh it before trying again.',
  );
async function access(tx: Tx, actor: Actor, sid: string, view: NoticeView) {
  await scope(tx, sid);
  if (view === 'ADMIN') return requireAdmin(tx, actor, sid);
  const [result] = await tx.$queryRaw<
    { allowed: boolean }[]
  >`SELECT portl_community.is_resident(${sid}) AS allowed`;
  if (!result?.allowed)
    throw new DomainError(
      403,
      'FORBIDDEN',
      'Current society residency is required',
    );
}
async function load(tx: Tx, sid: string, id: string, lock = false) {
  if (lock)
    await tx.$queryRaw`SELECT id FROM portl_community."Notice" WHERE id=${id} AND "societyId"=${sid} FOR UPDATE`;
  const row = await tx.notice.findFirst({ where: { id, societyId: sid } });
  if (!row)
    throw new DomainError(404, 'NOT_FOUND', 'Notice no longer available');
  return row;
}
export function noticeService(db: PrismaClient) {
  return {
    list: (actor: Actor, sid: string, input: z.infer<typeof noticeListQuery>) =>
      withActor(db, actor, async (tx) => {
        await access(tx, actor, sid, input.view);
        if (
          input.view === 'RESIDENT' &&
          input.status &&
          input.status !== 'PUBLISHED'
        )
          throw new DomainError(
            422,
            'VALIDATION_ERROR',
            'Residents can view published notices',
          );
        let cursor: z.infer<typeof cursorSchema> | undefined;
        if (input.cursor) {
          try {
            cursor = cursorSchema.parse(
              JSON.parse(
                Buffer.from(input.cursor, 'base64url').toString('utf8'),
              ),
            );
          } catch {
            throw new DomainError(
              422,
              'VALIDATION_ERROR',
              'Invalid notice cursor',
            );
          }
        }
        const rows = await tx.notice.findMany({
          where: {
            societyId: sid,
            ...(input.view === 'RESIDENT'
              ? { status: 'PUBLISHED' }
              : input.status
                ? { status: input.status }
                : {}),
            ...(cursor
              ? {
                  OR: [
                    { createdAt: { lt: new Date(cursor.at) } },
                    { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 21,
          omit: { body: true },
        });
        const items = rows.slice(0, 20),
          last = items.at(-1);
        return {
          items: items.map(summary),
          nextCursor:
            rows.length > 20 && last
              ? Buffer.from(
                  JSON.stringify({
                    at: last.createdAt.toISOString(),
                    id: last.id,
                  }),
                ).toString('base64url')
              : null,
        };
      }),
    detail: (actor: Actor, sid: string, id: string, view: NoticeView) =>
      withActor(db, actor, async (tx) => {
        await access(tx, actor, sid, view);
        const row = await load(tx, sid, id);
        if (view === 'RESIDENT' && row.status !== 'PUBLISHED')
          throw new DomainError(404, 'NOT_FOUND', 'Notice no longer available');
        return dto(row);
      }),
    create: (
      actor: Actor,
      sid: string,
      input: z.infer<typeof noticeCreateInput>,
    ) =>
      withActor(db, actor, async (tx) => {
        await requireAdmin(tx, actor, sid);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'notice:' + input.id},0))`;
        const inserted = await tx.notice.createMany({
          data: { ...input, societyId: sid, createdBy: actor.userId },
          skipDuplicates: true,
        });
        const row = await tx.notice.findFirst({
          where: { id: input.id, societyId: sid },
        });
        if (
          !row ||
          row.createdBy !== actor.userId ||
          row.status !== 'DRAFT' ||
          row.title !== input.title ||
          row.body !== input.body
        )
          throw conflict();
        if (inserted.count)
          await audit(tx, actor, sid, 'NOTICE_CREATED', row.id);
        return dto(row);
      }),
    edit: (
      actor: Actor,
      sid: string,
      id: string,
      input: z.infer<typeof noticeEditInput>,
    ) =>
      withActor(db, actor, async (tx) => {
        await requireAdmin(tx, actor, sid);
        const row = await load(tx, sid, id, true);
        if (row.status !== 'DRAFT' || row.version !== input.expectedVersion)
          throw conflict();
        const edited = await tx.notice.update({
          where: { id },
          data: {
            title: input.title,
            body: input.body,
            version: { increment: 1 },
          },
        });
        await audit(tx, actor, sid, 'NOTICE_EDITED', id);
        return dto(edited);
      }),
    command: (
      actor: Actor,
      sid: string,
      id: string,
      expectedVersion: number,
      action: 'publish' | 'archive',
    ) => {
      const transaction =
        action === 'publish' ? withNotificationTransaction : withActor;
      return transaction(db, actor, async (tx) => {
        await requireAdmin(tx, actor, sid);
        const row = await load(tx, sid, id, true),
          target = action === 'publish' ? 'PUBLISHED' : 'ARCHIVED';
        if (row.status === target && row.version === expectedVersion + 1)
          return dto(row);
        if (
          row.version !== expectedVersion ||
          row.status === 'ARCHIVED' ||
          (action === 'publish' && row.status !== 'DRAFT')
        )
          throw conflict();
        const changed = await tx.notice.update({
          where: { id },
          data: {
            status: target,
            version: { increment: 1 },
            ...(action === 'publish'
              ? { publishedAt: new Date() }
              : { archivedAt: new Date() }),
          },
        });
        if (action === 'publish') {
          const records = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM portl_community.notify_notice(${id})`;
          await enqueueNotificationBatch(db, tx, records);
        }
        await audit(
          tx,
          actor,
          sid,
          action === 'publish' ? 'NOTICE_PUBLISHED' : 'NOTICE_ARCHIVED',
          id,
        );
        return dto(changed);
      });
    },
  };
}
