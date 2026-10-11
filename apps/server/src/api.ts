import { passCodes } from './gate/pass-codes.js';
import { pino } from 'pino';

import { createApp } from './app.js';
import { parseRuntimeEnv } from './config/env.js';
import { parseAuthEnv } from './config/auth-env.js';
import { assertRestrictedRuntime, createDatabase } from './database/client.js';
import { createAuth } from './auth/auth.js';
import { resendDelivery } from './auth/email.js';

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
const server = createApp(logger, {
  auth,
  db,
  baseURL: authEnv.BETTER_AUTH_URL,
  passCodes: passCodes(authEnv.BETTER_AUTH_SECRET),
}).listen(env.PORT, env.HOST, () => {
  logger.info({ port: env.PORT }, 'API listening');
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
  server.close(async (error) => {
    clearTimeout(deadline);
    if (error) process.exitCode = 1;
    await db.$disconnect();
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
