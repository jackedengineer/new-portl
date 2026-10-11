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
    base: { service: 'portl-notifications' },
  });
const config = z
  .object({
    WORKER_DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  })
  .safeParse(process.env);
if (!config.success) {
  logger.fatal(
    'Configure WORKER_DATABASE_URL and BETTER_AUTH_SECRET; secrets withheld',
  );
  process.exit(1);
}
const db = createDatabase(config.data.WORKER_DATABASE_URL),
  boss = notificationQueue(db, true),
  cipher = tokenCipher(config.data.BETTER_AUTH_SECRET),
  provider = expoProvider(config.data.EXPO_ACCESS_TOKEN);
try {
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
  logger.info('Notification worker ready');
} catch {
  logger.fatal(
    'Notification worker startup failed; check restricted grants and queue initialization',
  );
  await boss.stop();
  await db.$disconnect();
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
  await boss.stop({ timeout: 15000 });
  await db.$disconnect();
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
