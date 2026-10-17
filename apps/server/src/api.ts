import { createServer } from 'node:http';
import { createGateSocketServer } from './gate/live.js';
import { gateLiveAccess } from './gate/live-access.js';
import { tokenCipher } from './notifications/tokens.js';
import { stopNotificationQueue } from './notifications/jobs.js';
import { passCodes } from './gate/pass-codes.js';
import { pino } from 'pino';

import { createApp } from './app.js';
import { parseRuntimeEnv } from './config/env.js';
import { parseAuthEnv } from './config/auth-env.js';
import { assertRestrictedRuntime, createDatabase } from './database/client.js';
import { createAuth } from './auth/auth.js';
import { resendDelivery } from './auth/email.js';
import { signalWorker } from './hosting/activity.js';

const env = parseRuntimeEnv(process.env);
const logger = pino({ level: env.LOG_LEVEL, base: { service: 'portl-api' } });
const authEnv = parseAuthEnv(process.env, env.NODE_ENV);
const db = createDatabase(authEnv.DATABASE_URL);
try {
  await assertRestrictedRuntime(db);
} catch {
  logger.fatal('Database unavailable or runtime role is not restricted');
  await db.$disconnect();
  process.exit(1);
}
const auth = createAuth(
  db,
  authEnv,
  resendDelivery(authEnv.RESEND_API_KEY, authEnv.EMAIL_FROM),
);
const server = createServer(
  createApp(logger, {
    auth,
    db,
    baseURL: authEnv.BETTER_AUTH_URL,
    passCodes: passCodes(authEnv.BETTER_AUTH_SECRET),
    tokenCipher: tokenCipher(authEnv.BETTER_AUTH_SECRET),
    onGateChange: (signal) => live.publish(signal),
  }),
);
const live = createGateSocketServer(server, {
  authorize: gateLiveAccess(auth, db),
  acceptsOrigin: auth.acceptsOrigin,
  budget: (userId) => auth.budget(userId, 'gate-live-connect', 20, 60),
});
// Completed application requests keep draining during active use. Health and
// public legal reads never wake the database worker. Lost hints are recoverable.
server.on('request', (req, res) => {
  if (!/^\/(v1\/|api\/auth\/|delete-account\/)/.test(req.url ?? '')) return;
  res.once('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 400) signalWorker();
  });
});
server.listen(env.PORT, env.HOST, () => {
  logger.info({ port: env.PORT }, 'API listening');
  process.send?.({ type: 'ready' }, () => {});
});
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.on('error', async (error: NodeJS.ErrnoException) => {
  logger.fatal({ code: error.code }, 'API server failed');
  process.exitCode = 1;
  await db.$disconnect();
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'API shutting down');
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exitCode = 1;
  }, 10_000);
  deadline.unref();
  void live.close().then(async () => {
    clearTimeout(deadline);
    await stopNotificationQueue(db);
    await db.$disconnect();
    if (process.connected) process.disconnect?.();
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
