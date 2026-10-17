import { mkdir } from 'node:fs/promises';
import { fileLedger, type DeletionLedger } from './account/ledger.js';
import {
  databaseLedger,
  independentLedgerUrl,
} from './account/database-ledger.js';
import pg from 'pg';
import { postgresOptions } from './database/connection.js';
import { isAbsolute, resolve } from 'node:path';
import { accountWorker } from './account/worker.js';
import { pino } from 'pino';
import { z } from 'zod';
import { createDatabase } from './database/client.js';
import { parseRuntimeEnv } from './config/env.js';
import { notificationQueue } from './notifications/jobs.js';
import { assertNotificationWorker } from './notifications/worker-access.js';
import { tokenCipher } from './notifications/tokens.js';
import { expoProvider } from './notifications/provider.js';
import {
  deliverNotification,
  collectReceipt,
} from './notifications/delivery.js';
const env = parseRuntimeEnv(process.env),
  logger = pino({
    level: env.LOG_LEVEL,
    base: { service: 'portl-worker' },
  });
const config = z
  .object({
    WORKER_DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    ACCOUNT_DELETION_LEDGER_DIR: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().refine(isAbsolute).optional(),
    ),
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
    ERASURE_LEDGER_DATABASE_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.url().optional(),
    ),
  })
  .safeParse(process.env);
if (
  !config.success ||
  (env.NODE_ENV === 'production' &&
    !config.data.ACCOUNT_DELETION_LEDGER_DIR &&
    !config.data.ERASURE_LEDGER_DATABASE_URL) ||
  (config.success &&
    !!config.data.ACCOUNT_DELETION_LEDGER_DIR &&
    !!config.data.ERASURE_LEDGER_DATABASE_URL)
) {
  logger.fatal(
    'Configure WORKER_DATABASE_URL and BETTER_AUTH_SECRET; secrets withheld',
  );
  process.exit(1);
}
const db = createDatabase(config.data.WORKER_DATABASE_URL),
  boss = notificationQueue(db, true),
  cipher = tokenCipher(config.data.BETTER_AUTH_SECRET),
  provider = expoProvider(config.data.EXPO_ACCESS_TOKEN);
let stopAccounts: (() => Promise<void>) | undefined;
let ledgerClient: pg.Pool | undefined;
try {
  let storage: DeletionLedger;
  if (config.data.ERASURE_LEDGER_DATABASE_URL) {
    ledgerClient = new pg.Pool({
      ...postgresOptions(
        independentLedgerUrl(
          config.data.ERASURE_LEDGER_DATABASE_URL,
          config.data.WORKER_DATABASE_URL,
        ),
      ),
      max: 1,
    });
    storage = databaseLedger(ledgerClient);
  } else {
    const ledgerPath =
      config.data.ACCOUNT_DELETION_LEDGER_DIR ||
      resolve('.private/account-deletions');
    if (env.NODE_ENV !== 'production')
      await mkdir(ledgerPath, { recursive: true, mode: 0o700 });
    storage = fileLedger(ledgerPath);
    await storage.assertReady();
  }
  await assertNotificationWorker(db);
  await boss.start();
  for (const name of ['notification.push', 'notification.receipt'] as const)
    await boss.work(
      name,
      { batchSize: 1, pollingIntervalSeconds: 3 },
      async (jobs) => {
        for (const job of jobs) {
          try {
            if (name === 'notification.push')
              await deliverNotification(
                db,
                boss,
                provider,
                cipher,
                z.strictObject({ notificationId: z.uuid() }).parse(job.data)
                  .notificationId,
              );
            else
              await collectReceipt(
                db,
                provider,
                z.strictObject({ deliveryId: z.uuid() }).parse(job.data)
                  .deliveryId,
              );
            logger.info(
              { queue: name, jobId: job.id },
              'Notification job completed',
            );
          } catch {
            logger.warn(
              { queue: name, jobId: job.id },
              'Notification job will retry within its configured limit',
            );
            throw new Error('NOTIFICATION_JOB_RETRY');
          }
        }
      },
    );
  stopAccounts = await accountWorker(db, logger, storage);
  logger.info('Notification and account lifecycle worker ready');
} catch {
  logger.fatal(
    'Notification worker startup failed; check restricted grants and queue initialization',
  );
  await boss.stop();
  await db.$disconnect();
  await ledgerClient?.end();
  process.exit(1);
}
const maintenance = setInterval(
  () =>
    void db.$queryRaw`SELECT portl_notifications.cleanup()`.catch(() =>
      logger.error('Notification retention maintenance failed'),
    ),
  3600000,
);
maintenance.unref();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(maintenance);
  await stopAccounts?.();
  await boss.stop({ timeout: 15000 });
  await db.$disconnect();
  await ledgerClient?.end();
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
