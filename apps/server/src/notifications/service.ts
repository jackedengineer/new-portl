import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  notificationPreview,
  notificationType,
  type NotificationContext,
  type DeviceRegistration,
} from '@portl/contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  DomainError,
  scope,
  withActor,
  type Actor,
  type Tx,
} from '../registry/context.js';
import type { TokenCipher } from './tokens.js';
const cursorSchema = z.object({ at: z.iso.datetime(), id: z.uuid() });
export function notificationService(db: PrismaClient, cipher?: TokenCipher) {
  async function previews(tx: Tx, ids: string[]) {
    const rows = await tx.$queryRaw<
      { id: string; context: NotificationContext }[]
    >`
      SELECT * FROM portl_notifications.inbox_previews(${ids}::text[])
    `;
    return new Map(rows.map((row) => [row.id, row.context]));
  }
  const dto = (
    n: {
      id: string;
      societyId: string;
      type: string;
      resourceKind: string;
      resourceId: string;
      view: string;
      createdAt: Date;
      readAt: Date | null;
    },
    context?: NotificationContext,
  ) => ({
    id: n.id,
    societyId: n.societyId,
    type: n.type,
    resourceKind: n.resourceKind,
    resourceId: n.resourceId,
    view: n.view,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
    preview: notificationPreview(notificationType.parse(n.type), context),
  });
  const missing = () =>
    new DomainError(404, 'NOT_FOUND', 'Notification no longer available');
  // Scope is obtained from an owned row through a narrowly checked RPC, never from tap data.
  async function societies(
    tx: Parameters<Parameters<typeof withActor>[2]>[0],
    actor: Actor,
  ) {
    return tx.membership.findMany({
      where: { userId: actor.userId, active: true },
      select: { societyId: true },
    });
  }
  return {
    list: (actor: Actor, encoded?: string) =>
      withActor(db, actor, async (tx) => {
        let cursor: z.infer<typeof cursorSchema> | undefined;
        if (encoded) {
          try {
            cursor = cursorSchema.parse(
              JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')),
            );
          } catch {
            throw new DomainError(
              422,
              'VALIDATION_ERROR',
              'Invalid inbox cursor',
            );
          }
        }
        const rows: Awaited<ReturnType<typeof tx.notification.findMany>> = [];
        let unread = 0;
        const contexts = new Map<string, NotificationContext>();
        const memberships = await societies(tx, actor);
        for (const sid of new Set(memberships.map((m) => m.societyId))) {
          await scope(tx, sid);
          const found = await tx.notification.findMany({
            where: cursor
              ? {
                  OR: [
                    { createdAt: { lt: new Date(cursor.at) } },
                    { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
                  ],
                }
              : {},
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 31,
          });
          rows.push(...found);
          for (const [id, context] of await previews(
            tx,
            found.map((row) => row.id),
          ))
            contexts.set(id, context);
          unread += await tx.notification.count({ where: { readAt: null } });
        }
        rows.sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.id.localeCompare(a.id),
        );
        const items = rows.slice(0, 30),
          last = items.at(-1);
        return {
          items: items.map((row) => dto(row, contexts.get(row.id))),
          unread,
          nextCursor:
            rows.length > 30 && last
              ? Buffer.from(
                  JSON.stringify({
                    at: last.createdAt.toISOString(),
                    id: last.id,
                  }),
                ).toString('base64url')
              : null,
        };
      }),
    detail: (actor: Actor, id: string, read = false) =>
      withActor(db, actor, async (tx) => {
        for (const sid of new Set(
          (await societies(tx, actor)).map((m) => m.societyId),
        )) {
          await scope(tx, sid);
          const row = await tx.notification.findUnique({ where: { id } });
          if (!row) continue;
          if (read && !row.readAt) {
            const changed = await tx.notification.updateMany({
              where: { id, readAt: null },
              data: { readAt: new Date() },
            });
            if (!changed.count) throw missing();
            const updated = await tx.notification.findUnique({ where: { id } });
            if (!updated) throw missing();
            return dto(updated, (await previews(tx, [id])).get(id));
          }
          return dto(row, (await previews(tx, [id])).get(id));
        }
        throw missing();
      }),
    register: (actor: Actor, input: DeviceRegistration) =>
      withActor(db, actor, async (tx) => {
        if (!cipher)
          throw new DomainError(
            503,
            'PUSH_UNAVAILABLE',
            'Push registration is not configured',
          );
        const gen = randomUUID(),
          hash = cipher.digest(input.token),
          sealed = cipher.seal(input.token, input.installationId, gen);
        const [result] = await tx.$queryRaw<
          { registered: boolean }[]
        >`SELECT portl_notifications.register_device(${input.installationId},${hash},${sealed},${gen},${input.platform}) AS registered`;
        if (!result?.registered)
          throw new DomainError(
            409,
            'DEVICE_CONFLICT',
            'This device could not be linked. Sign out of its other account or disable its existing registration first.',
          );
        return { success: true };
      }),
    remove: (actor: Actor, id: string) =>
      withActor(db, actor, async (tx) => {
        await tx.$queryRaw`SELECT portl_notifications.remove_device(${id})::text`;
        return { success: true };
      }),
  };
}
