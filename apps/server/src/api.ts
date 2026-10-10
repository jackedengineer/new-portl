import { pino } from 'pino';

import { createApp } from './app.js';
import { parseRuntimeEnv } from './config/env.js';

const env = parseRuntimeEnv(process.env);
const logger = pino({ level: env.LOG_LEVEL, base: { service: 'portl-api' } });
const server = createApp(logger).listen(env.PORT, env.HOST, () => {
  logger.info({ port: env.PORT }, 'API listening');
});
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.on('error', (error: NodeJS.ErrnoException) => {
  logger.fatal({ code: error.code }, 'API server failed');
  process.exitCode = 1;
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
  server.close((error) => {
    clearTimeout(deadline);
    if (error) process.exitCode = 1;
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
