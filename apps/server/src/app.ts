import { randomUUID } from 'node:crypto';

import express from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';

export function createApp(logger?: Logger) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);
    res.setHeader('cache-control', 'no-store');
    res.on('finish', () => {
      logger?.info(
        { requestId, method: req.method, statusCode: res.statusCode },
        'HTTP request completed',
      );
    });
    next();
  });

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        requestId: res.getHeader('x-request-id'),
      },
    });
  });

  return app;
}
