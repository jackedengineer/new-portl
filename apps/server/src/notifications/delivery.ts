import { randomUUID } from 'node:crypto';
import { PgBoss, fromPrisma } from 'pg-boss';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { TokenCipher } from './tokens.js';
import type { PushProvider } from './provider.js';
type Target = {
  deviceId: string;
  generation: string;
  cipherText: string;
  type: string;
  expiresAt: Date;
};
const targets = (db: PrismaClient, id: string) =>
  db.$queryRaw<
    Target[]
  >`SELECT * FROM portl_notifications.delivery_targets(${id})`;
async function retire(db: PrismaClient, id: string, generation: string) {
  await db.$queryRaw`SELECT portl_notifications.retire_device(${id},${generation})::text`;
}
export async function deliverNotification(
  db: PrismaClient,
  boss: PgBoss,
  provider: PushProvider,
  cipher: TokenCipher,
  id: string,
) {
  let retryNeeded = false;
  for (const target of await targets(db, id)) {
    const row = await db.delivery.upsert({
      where: {
        notificationId_deviceId_generation: {
          notificationId: id,
          deviceId: target.deviceId,
          generation: target.generation,
        },
      },
      create: {
        id: randomUUID(),
        notificationId: id,
        deviceId: target.deviceId,
        generation: target.generation,
      },
      update: {},
    });
    if (row.status !== 'PENDING') continue;
    // A revoked session, changed grant or rotated token between claim and delivery invalidates this generation.
    const live = (await targets(db, id)).find(
      (t) =>
        t.deviceId === target.deviceId && t.generation === target.generation,
    );
    const ttl = live
      ? Math.floor((live.expiresAt.getTime() - Date.now()) / 1000)
      : 0;
    if (!live || ttl <= 0) {
      await db.delivery.update({
        where: { id: row.id },
        data: { status: 'SKIPPED' },
      });
      continue;
    }
    const result = await provider.send(
      cipher.open(live.cipherText, live.deviceId, live.generation),
      id,
      ttl,
    );
    if (result.status === 'retry') {
      await db.delivery.update({
        where: { id: row.id },
        data: { errorCode: result.code },
      });
      retryNeeded = true;
      continue;
    }
    if (result.status === 'error') {
      if (result.code === 'DeviceNotRegistered')
        await retire(db, live.deviceId, live.generation);
      await db.delivery.update({
        where: { id: row.id },
        data: { status: 'FAILED', errorCode: result.code },
      });
      continue;
    }
    const ticketId = result.ticketId;
    if (!ticketId) throw new Error('NOTIFICATION_TICKET_MISSING');
    await db.$transaction(async (tx) => {
      await tx.delivery.update({
        where: { id: row.id },
        data: { status: 'ACCEPTED', ticketId, errorCode: null },
      });
      const job = await boss.sendAfter(
        'notification.receipt',
        { deliveryId: row.id },
        { db: fromPrisma(tx) },
        900,
      );
      if (!job) throw new Error('NOTIFICATION_RECEIPT_QUEUE_FAILED');
    });
  }
  if (retryNeeded) throw new Error('NOTIFICATION_DELIVERY_RETRY');
}
export async function collectReceipt(
  db: PrismaClient,
  provider: PushProvider,
  id: string,
) {
  const row = await db.delivery.findUnique({ where: { id } });
  if (!row || row.status !== 'ACCEPTED' || !row.ticketId) return;
  if (Date.now() - row.createdAt.getTime() >= 86400000) {
    await db.delivery.update({
      where: { id },
      data: { status: 'FAILED', errorCode: 'RECEIPT_TIMEOUT' },
    });
    return;
  }
  const result = await provider.receipt(row.ticketId);
  if (result.status === 'retry') throw new Error('NOTIFICATION_RECEIPT_RETRY');
  if (result.status === 'error' && result.code === 'DeviceNotRegistered')
    await retire(db, row.deviceId, row.generation);
  await db.delivery.update({
    where: { id },
    data: {
      status: result.status === 'ok' ? 'RECEIPT_OK' : 'FAILED',
      errorCode: result.status === 'error' ? result.code : null,
    },
  });
}
