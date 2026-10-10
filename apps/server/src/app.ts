import { randomUUID } from 'node:crypto';

import express from 'express';
import helmet from 'helmet';
import { fromNodeHeaders } from 'better-auth/node';
import type { Logger } from 'pino';

import { authRoutes, type PortlAuth } from './auth/auth.js';
import type { PrismaClient } from './generated/prisma/client.js';

type AppServices = { auth: PortlAuth; db: PrismaClient; baseURL: string };

export function createApp(logger?: Logger, services?: AppServices) {
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

  if (services) {
    app.get('/health/ready', async (_req, res) => {
      try {
        await services.db.$queryRaw`SELECT 1`;
        res.json({ status: 'ok' });
      } catch {
        res.status(503).json({ status: 'unavailable' });
      }
    });

    app.use('/api/auth', (req, res, next) => {
      if (authRoutes.get(req.path) !== req.method) return next();
      if (req.method === 'POST' && !req.is('application/json')) {
        res.status(415).json({
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Use application/json',
          },
        });
        return;
      }
      next();
    });
    app.all(
      '/api/auth/*splat',
      express.json({ limit: '8kb' }),
      async (req, res) => {
        const path = req.path.slice('/api/auth'.length);
        if (authRoutes.get(path) !== req.method) {
          res
            .status(404)
            .json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
          return;
        }
        const headers = fromNodeHeaders(req.headers);
        // req.ip uses Express's default trust-proxy=false. Ignore spoofed forwarding headers.
        headers.set('x-portl-client-ip', req.ip || '127.0.0.1');
        headers.delete('content-length');
        // Use Better Auth's Fetch handler after bounded JSON parsing. Its Node adapter expects an unread stream.
        const response = await services.auth.handler(
          new Request(new URL(req.originalUrl, services.baseURL), {
            method: req.method,
            headers,
            ...(req.method === 'POST'
              ? { body: JSON.stringify(req.body) }
              : {}),
          }),
        );
        response.headers.forEach((value, key) => {
          if (key !== 'set-cookie') res.setHeader(key, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader('set-cookie', cookies);
        res.status(response.status).send(await response.text());
      },
    );

    app.get('/v1/me', async (req, res) => {
      const session = await services.auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!session) {
        res.status(401).json({
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Sign in to continue',
            requestId: res.getHeader('x-request-id'),
          },
        });
        return;
      }
      const { id, email, name, emailVerified } = session.user;
      res.json({
        user: { id, email, name, emailVerified },
        memberships: [],
        onboardingRequired: true,
      });
    });
  }

  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        next(error);
        return;
      }
      const status =
        typeof error === 'object' && error !== null && 'status' in error
          ? error.status
          : undefined;
      const code =
        status === 413
          ? 'PAYLOAD_TOO_LARGE'
          : status === 400
            ? 'INVALID_JSON'
            : 'INTERNAL_ERROR';
      res.status(status === 413 || status === 400 ? status : 500).json({
        error: {
          code,
          message: 'Unable to process request',
          requestId: res.getHeader('x-request-id'),
        },
      });
    },
  );

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
