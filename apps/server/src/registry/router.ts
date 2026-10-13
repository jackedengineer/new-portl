import express from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import {
  applicationInput,
  decisionInput,
  idSchema,
  invitationInput,
  societyLookupInput,
  tokenInput,
} from '@portl/contracts';
import { z } from 'zod';
import type { PortlAuth } from '../auth/auth.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { DomainError, type Actor } from './context.js';
import { registryService } from './service.js';

export function registryRouter(auth: PortlAuth, db: PrismaClient) {
  const router = express.Router();
  const service = registryService(db);
  router.use(async (req, res, next) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session?.user.emailVerified)
      throw new DomainError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    const expectedUserId = req.get('x-portl-expected-user');
    if (expectedUserId && expectedUserId !== session.user.id)
      throw new DomainError(
        401,
        'SESSION_CHANGED',
        'Your session changed. Please try again.',
      );
    const actor: Actor = {
      userId: session.user.id,
      email: session.user.email,
      sessionId: session.session.id,
      requestId: String(res.getHeader('x-request-id')),
    };
    res.locals.actor = actor;
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
      if (!(await auth.budget(actor.userId, 'registry-mutation', 30, 60)))
        throw new DomainError(
          429,
          'RATE_LIMITED',
          'Please wait before trying again',
        );
    }
    next();
  });
  router.use(express.json({ limit: '8kb' }));
  const actor = (res: express.Response) => res.locals.actor as Actor;
  const body = <T>(schema: z.ZodType<T>, req: express.Request): T => {
    const result = schema.safeParse(req.body);
    if (!result.success)
      throw new DomainError(
        422,
        'VALIDATION_ERROR',
        'Check the form details and try again',
      );
    return result.data;
  };
  const id = (value: unknown) => {
    const result = idSchema.safeParse(value);
    if (!result.success)
      throw new DomainError(400, 'INVALID_ID', 'Invalid request');
    return result.data;
  };
  const cursor = (req: express.Request) =>
    req.query.cursor === undefined ? undefined : id(req.query.cursor);
  router.post('/onboarding/society-lookup', async (req, res) => {
    const input = body(societyLookupInput, req);
    if (!(await auth.budget(actor(res).userId, 'society-lookup', 10, 60)))
      throw new DomainError(
        429,
        'RATE_LIMITED',
        'Please wait before checking another society code',
      );
    res.json(await service.lookup(actor(res), input.code, input.cursor));
  });
  router.post('/onboarding/invitation-preview', async (req, res) => {
    const input = body(tokenInput, req);
    res.json(await service.preview(actor(res), input.token));
  });
  router.post('/onboarding/invitation-accept', async (req, res) => {
    const input = body(tokenInput, req);
    res.json(await service.accept(actor(res), input.token));
  });
  router.get('/onboarding/applications', async (req, res) =>
    res.json(await service.applications(actor(res), cursor(req))),
  );
  router.post('/onboarding/applications/:id/withdraw', async (req, res) => {
    body(z.strictObject({}), req);
    res.json(await service.withdraw(actor(res), id(req.params.id)));
  });
  router.post('/societies/:societyId/applications', async (req, res) => {
    const input = body(applicationInput, req);
    if (
      !(await auth.budget(actor(res).userId, 'resident-application', 5, 3600))
    )
      throw new DomainError(
        429,
        'RATE_LIMITED',
        'Please wait before submitting another application',
      );
    res
      .status(201)
      .json(await service.apply(actor(res), id(req.params.societyId), input));
  });
  router.get('/societies/:societyId/admin/flats', async (req, res) =>
    res.json(
      await service.adminFlats(
        actor(res),
        id(req.params.societyId),
        cursor(req),
      ),
    ),
  );
  router.get('/societies/:societyId/admin/applications', async (req, res) =>
    res.json(
      await service.reviewQueue(
        actor(res),
        id(req.params.societyId),
        cursor(req),
      ),
    ),
  );
  router.get('/societies/:societyId/admin/invitations', async (req, res) =>
    res.json(
      await service.invitations(
        actor(res),
        id(req.params.societyId),
        cursor(req),
      ),
    ),
  );
  router.post('/societies/:societyId/admin/invitations', async (req, res) => {
    const input = body(invitationInput, req);
    if (
      !(await auth.budget(actor(res).userId, 'resident-invitation', 20, 3600))
    )
      throw new DomainError(
        429,
        'RATE_LIMITED',
        'Please wait before creating another invitation',
      );
    res
      .status(201)
      .json(await service.invite(actor(res), id(req.params.societyId), input));
  });
  router.post(
    '/societies/:societyId/admin/invitations/:id/revoke',
    async (req, res) => {
      body(z.strictObject({}), req);
      res.json(
        await service.revoke(
          actor(res),
          id(req.params.societyId),
          id(req.params.id),
        ),
      );
    },
  );
  router.post(
    '/societies/:societyId/admin/applications/:id/decision',
    async (req, res) =>
      res.json(
        await service.decide(
          actor(res),
          id(req.params.societyId),
          id(req.params.id),
          body(decisionInput, req),
        ),
      ),
  );
  return router;
}
