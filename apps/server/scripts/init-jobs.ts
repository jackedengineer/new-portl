import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { postgresOptions } from '../src/database/connection.js';
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is required');
const pool = new pg.Pool(postgresOptions(url));
const boss = new PgBoss({
  schema: 'portl_jobs',
  db: { executeSql: (sql, values) => pool.query(sql, values) },
  supervise: false,
  schedule: false,
});
boss.on('error', () =>
  console.error('Queue initialization error; credentials withheld'),
);
try {
  await boss.start();
  for (const name of ['notification.push', 'notification.receipt'])
    await boss.createQueue(name, {
      retryLimit: 8,
      retryDelay: 15,
      retryBackoff: true,
      retryDelayMax: 1800,
      expireInSeconds: 120,
      retentionSeconds: 86400,
      deleteAfterSeconds: 604800,
    });
  console.log(
    'Notification queues initialized. Runtime migrations remain disabled.',
  );
} catch {
  console.error(
    'Queue initialization failed; check migration credentials and connectivity.',
  );
  process.exitCode = 1;
} finally {
  await boss.stop();
  await pool.end();
}
