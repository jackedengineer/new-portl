import { POLICY_VERSION } from '@portl/contracts';
import { accountRouter } from './account/router.js';
import { publicAccountRouter } from './account/public.js';
import { requestClientIP, type TrustedIngress } from './hosting/client-ip.js';
import type { GateSignal } from '@portl/contracts';
import { notificationRouter } from './notifications/router.js';
import { noticeRouter } from './notices/router.js';
import type { TokenCipher } from './notifications/tokens.js';
import { randomUUID } from 'node:crypto';

import express from 'express';
import { administrationRouter } from './administration/router.js';
import helmet from 'helmet';
import { fromNodeHeaders } from 'better-auth/node';
import type { Logger } from 'pino';

import { gateRouter } from './gate/router.js';
import { registryRouter } from './registry/router.js';
import { DomainError } from './registry/context.js';
import { registryService } from './registry/service.js';

import { authRoutes, type PortlAuth } from './auth/auth.js';
import type { PrismaClient } from './generated/prisma/client.js';

import type { PassCodes } from './gate/pass-codes.js';

type AppServices = {
  auth: PortlAuth;
  db: PrismaClient;
  baseURL: string;
  passCodes: PassCodes;
  tokenCipher?: TokenCipher;
  onGateChange?: (signal: GateSignal) => void;
};

export function createApp(
  logger?: Logger,
  services?: AppServices,
  trustedIngress: TrustedIngress = 'none',
) {
  const app = express();
  app.set('trust proxy', false);
  app.set('portl trusted ingress', trustedIngress);
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
    app.use((req, res, next) => {
      const origin = req.get('origin');
      if (origin && services.auth.acceptsOrigin(origin)) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('access-control-allow-credentials', 'true');
        res.vary('Origin');
        if (req.method === 'OPTIONS') {
          res.setHeader('access-control-allow-methods', 'GET, POST');
          res.setHeader(
            'access-control-allow-headers',
            'content-type,x-portl-expected-user',
          );
          res.sendStatus(204);
          return;
        }
      } else if (req.method === 'OPTIONS') {
        res.sendStatus(403);
        return;
      }
      next();
    });
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
        headers.set('x-portl-client-ip', requestClientIP(req));
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

    app.use(publicAccountRouter(services.auth, services.baseURL));
    app.use('/v1/account', accountRouter(services.auth));
    app.get('/v1/me', async (req, res) => {
      const session = await services.auth.accountSession({
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
      const policy = await services.db.accountPolicy.findUnique({
        where: { userId: id },
      });
      const policyRequired =
        !policy?.adult || policy.version !== POLICY_VERSION;
      const memberships = policyRequired
        ? []
        : await registryService(services.db).memberships({
            userId: id,
            email,
            sessionId: session.session.id,
            requestId: String(res.getHeader('x-request-id')),
          });
      const assurance = await services.db.adminAssurance.findUnique({
        where: { sessionId: session.session.id },
      });
      const authenticator = await services.db.twoFactor.findUnique({
        where: { userId: id },
        select: { verified: true },
      });
      res.json({
        user: { id, email, name, emailVerified },
        policyRequired,
        reviewer: await services.auth.reviewer.identity(id),
        reviewLifecycle: await services.auth.lifecycle.identity(id),
        memberships,
        onboardingRequired: memberships.length === 0,
        adminAssuredUntil:
          assurance && assurance.expiresAt > new Date()
            ? assurance.expiresAt.toISOString()
            : null,
        adminAuthenticatorConfigured: !!authenticator?.verified,
      });
    });
    app.use(
      '/v1/societies/:societyId/gate',
      gateRouter(
        services.auth,
        services.db,
        services.passCodes,
        services.onGateChange,
      ),
    );
    app.use(
      '/v1/notifications',
      notificationRouter(services.auth, services.db, services.tokenCipher),
    );
    app.use(
      '/v1/societies/:societyId/notices',
      noticeRouter(services.auth, services.db),
    );
    app.use(
      '/v1/societies/:societyId',
      administrationRouter(services.auth, services.db),
    );
    app.use('/v1', registryRouter(services.auth, services.db));
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
      if (error instanceof DomainError) {
        if (error.status === 429) res.setHeader('retry-after', '60');
        res.status(error.status).json({
          error: {
            code: error.code,
            message: error.message,
            requestId: res.getHeader('x-request-id'),
          },
        });
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
