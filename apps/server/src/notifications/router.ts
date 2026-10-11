import express from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import {
  deviceRegistrationInput,
  deviceRemovalInput,
  notificationListQuery,
} from '@portl/contracts';
import type { PortlAuth } from '../auth/auth.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { DomainError, type Actor } from '../registry/context.js';
import { notificationService } from './service.js';
import type { TokenCipher } from './tokens.js';
export function notificationRouter(
  auth: PortlAuth,
  db: PrismaClient,
  cipher?: TokenCipher,
) {
  const router = express.Router(),
    service = notificationService(db, cipher);
  const parse = <T>(schema: z.ZodType<T>, input: unknown) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      throw new DomainError(
        422,
        'VALIDATION_ERROR',
        'Check the notification details',
      );
    return parsed.data;
  };
  const actor = (res: express.Response) => res.locals.actor as Actor;
  router.use(async (req, res, next) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session?.user.emailVerified)
      throw new DomainError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    if (
      req.get('x-portl-expected-user') &&
      req.get('x-portl-expected-user') !== session.user.id
    )
      throw new DomainError(
        401,
        'SESSION_CHANGED',
        'Your session changed. Please try again.',
      );
    res.locals.actor = {
      userId: session.user.id,
      email: session.user.email,
      sessionId: session.session.id,
      requestId: String(res.getHeader('x-request-id')),
    } satisfies Actor;
    if (req.method !== 'GET') {
      if (!req.is('application/json'))
        throw new DomainError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'Use application/json',
        );
      const origin = req.get('origin') || req.get('expo-origin');
      if (!origin || !auth.acceptsOrigin(origin))
        throw new DomainError(
          403,
          'UNTRUSTED_ORIGIN',
          'Request origin not allowed',
        );
    }
    if (!(await auth.budget(session.user.id, 'notifications', 120, 60)))
      throw new DomainError(
        429,
        'RATE_LIMITED',
        'Please wait before trying again',
      );
    next();
  });
  router.use(express.json({ limit: '4kb' }));
  router.get('/', async (req, res) =>
    res.json(
      await service.list(
        actor(res),
        parse(notificationListQuery, req.query).cursor,
      ),
    ),
  );
  router.post('/devices/register', async (req, res) =>
    res.json(
      await service.register(
        actor(res),
        parse(deviceRegistrationInput, req.body),
      ),
    ),
  );
  router.post('/devices/remove', async (req, res) =>
    res.json(
      await service.remove(
        actor(res),
        parse(deviceRemovalInput, req.body).installationId,
      ),
    ),
  );
  router.get('/:id', async (req, res) =>
    res.json(await service.detail(actor(res), parse(z.uuid(), req.params.id))),
  );
  router.post('/:id/read', async (req, res) => {
    parse(z.strictObject({}), req.body);
    res.json(
      await service.detail(actor(res), parse(z.uuid(), req.params.id), true),
    );
  });
  return router;
}
