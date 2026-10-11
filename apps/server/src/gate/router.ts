import express from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import {
  arrivalInput,
  gateCancelInput,
  gateDecisionInput,
  gateInput,
  gateListQuery,
  gateSetupQuery,
  gateView,
  guardAssignmentInput,
  idSchema,
  movementInput,
} from '@portl/contracts';
import { z } from 'zod';
import type { PortlAuth } from '../auth/auth.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { DomainError, type Actor } from '../registry/context.js';
import { gateAdmin } from './admin.js';
import { gateCommands } from './commands.js';
import { gateQueries } from './queries.js';
export function gateRouter(auth: PortlAuth, db: PrismaClient) {
  const router = express.Router({ mergeParams: true });
  const commands = gateCommands(db),
    queries = gateQueries(db),
    admin = gateAdmin(db);
  const parse = <T>(schema: z.ZodType<T>, value: unknown) => {
    const result = schema.safeParse(value);
    if (!result.success)
      throw new DomainError(
        422,
        'VALIDATION_ERROR',
        'Check the details and try again',
      );
    return result.data;
  };
  const actor = (res: express.Response) => res.locals.actor as Actor;
  const sid = (req: express.Request) => parse(idSchema, req.params.societyId);
  const id = (req: express.Request) => parse(idSchema, req.params.id);
  router.use(async (req, res, next) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session?.user.emailVerified)
      throw new DomainError(401, 'UNAUTHENTICATED', 'Sign in to continue');
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
        actor(res).userId,
        req.method === 'GET' ? 'gate-read' : 'gate-write',
        req.method === 'GET' ? 120 : 60,
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
  router.use(express.json({ limit: '8kb' }));
  router.get('/setup', async (req, res) => {
    const q = parse(gateSetupQuery, req.query);
    res.json(await queries.setup(actor(res), sid(req), q.view, q.search));
  });
  router.get('/requests', async (req, res) => {
    const q = parse(gateListQuery, req.query);
    res.json(
      await queries.list(actor(res), sid(req), q.view, q.filter, q.cursor),
    );
  });
  router.get('/requests/:id', async (req, res) => {
    const q = parse(z.strictObject({ view: gateView }), req.query);
    res.json(await queries.detail(actor(res), sid(req), id(req), q.view));
  });
  router.post('/requests', async (req, res) => {
    const input = parse(arrivalInput, req.body);
    if (!(await auth.budget(actor(res).userId, 'gate-arrival', 20, 60)))
      throw new DomainError(
        429,
        'RATE_LIMITED',
        'Please wait before registering another arrival',
      );
    res.status(201).json(await commands.register(actor(res), sid(req), input));
  });
  router.post('/requests/:id/decision', async (req, res) =>
    res.json(
      await commands.act(
        actor(res),
        sid(req),
        id(req),
        'decision',
        parse(gateDecisionInput, req.body),
      ),
    ),
  );
  router.post('/requests/:id/cancel', async (req, res) =>
    res.json(
      await commands.act(
        actor(res),
        sid(req),
        id(req),
        'cancel',
        parse(gateCancelInput, req.body),
      ),
    ),
  );
  for (const kind of ['entry', 'exit'] as const)
    router.post(`/requests/:id/${kind}`, async (req, res) =>
      res.json(
        await commands.act(
          actor(res),
          sid(req),
          id(req),
          kind,
          parse(movementInput, req.body),
        ),
      ),
    );
  router.post('/admin/gates', async (req, res) => {
    const input = parse(gateInput, req.body);
    res
      .status(201)
      .json(await admin.createGate(actor(res), sid(req), input.name));
  });
  router.post('/admin/assignments', async (req, res) => {
    const input = parse(guardAssignmentInput, req.body);
    res.status(201).json(await admin.assign(actor(res), sid(req), input));
  });
  router.post('/admin/assignments/:id/revoke', async (req, res) => {
    parse(z.strictObject({}), req.body);
    res.json(await admin.revoke(actor(res), sid(req), id(req)));
  });
  return router;
}
