import express from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import {
  idSchema,
  noticeView,
  noticeCreateInput,
  noticeEditInput,
  noticeCommandInput,
  noticeListQuery,
} from '@portl/contracts';
import type { PortlAuth } from '../auth/auth.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { DomainError, type Actor } from '../registry/context.js';
import { noticeService } from './service.js';

export function noticeRouter(auth: PortlAuth, db: PrismaClient) {
  const router = express.Router({ mergeParams: true }),
    service = noticeService(db);
  const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const result = schema.safeParse(value);
    if (!result.success)
      throw new DomainError(
        422,
        'VALIDATION_ERROR',
        'Check the notice details',
      );
    return result.data;
  };
  const actor = (res: express.Response) => res.locals.actor as Actor;
  const sid = (req: express.Request) => parse(idSchema, req.params.societyId);
  const id = (req: express.Request) => parse(z.uuid(), req.params.id);
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
    if (
      !(await auth.budget(
        session.user.id,
        req.method === 'GET' ? 'notice-read' : 'notice-write',
        req.method === 'GET' ? 120 : 30,
        60,
      ))
    )
      throw new DomainError(
        429,
        'RATE_LIMITED',
        'Please wait before trying again',
      );
    next();
  });
  router.use(express.json({ limit: '64kb' }));
  router.get('/', async (req, res) =>
    res.json(
      await service.list(
        actor(res),
        sid(req),
        parse(noticeListQuery, req.query),
      ),
    ),
  );
  router.post('/', async (req, res) =>
    res
      .status(201)
      .json(
        await service.create(
          actor(res),
          sid(req),
          parse(noticeCreateInput, req.body),
        ),
      ),
  );
  router.get('/:id', async (req, res) => {
    const query = parse(
      z.strictObject({ view: noticeView.default('RESIDENT') }),
      req.query,
    );
    res.json(await service.detail(actor(res), sid(req), id(req), query.view));
  });
  router.post('/:id/edit', async (req, res) =>
    res.json(
      await service.edit(
        actor(res),
        sid(req),
        id(req),
        parse(noticeEditInput, req.body),
      ),
    ),
  );
  for (const action of ['publish', 'archive'] as const)
    router.post(`/:id/${action}`, async (req, res) =>
      res.json(
        await service.command(
          actor(res),
          sid(req),
          id(req),
          parse(noticeCommandInput, req.body).expectedVersion,
          action,
        ),
      ),
    );
  return router;
}
