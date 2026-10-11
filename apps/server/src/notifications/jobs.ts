import { databasePool } from '../database/client.js';
import { PgBoss, fromPrisma } from 'pg-boss';
import type { PrismaClient } from '../generated/prisma/client.js';
import { withActor, type Actor, type Tx } from '../registry/context.js';
const senders = new WeakMap<PrismaClient, Promise<PgBoss>>();
export function notificationQueue(db: PrismaClient, worker = false) {
  const boss = new PgBoss({
    db: { executeSql: (sql, values) => databasePool(db).query(sql, values) },
    schema: 'portl_jobs',
    migrate: false,
    supervise: worker,
    schedule: false,
    reindex: false,
  });
  // Library errors can contain job data/provider tokens. Never serialize raw errors.
  boss.on('error', () => console.error('Notification queue operation failed'));
  return boss;
}
async function sender(db: PrismaClient) {
  let pending = senders.get(db);
  if (!pending) {
    const boss = notificationQueue(db);
    pending = boss.start().catch(async () => {
      senders.delete(db);
      await boss.stop();
      throw new Error('Notification queue unavailable');
    });
    senders.set(db, pending);
  }
  return pending;
}
export async function enqueueNotifications(
  db: PrismaClient,
  tx: Tx,
  records: { id: string }[],
) {
  if (!records.length) return;
  const boss = await sender(db);
  for (const record of records) {
    const id = await boss.send(
      'notification.push',
      { notificationId: record.id },
      { db: fromPrisma(tx) },
    );
    if (!id) throw new Error('Notification job could not be appended');
  }
}
export async function stopNotificationQueue(db: PrismaClient) {
  const pending = senders.get(db);
  if (pending) await (await pending).stop();
  senders.delete(db);
}

export async function withNotificationTransaction<T>(
  db: PrismaClient,
  actor: Actor,
  work: (tx: Tx) => Promise<T>,
) {
  await sender(db); // Never wait for queue startup while holding a domain transaction connection.
  return withActor(db, actor, work);
}
