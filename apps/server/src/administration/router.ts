import express from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import {
  administrationQuery,
  archiveInput,
  directoryCreateInput,
  directoryEditInput,
  directoryQuery,
  endOccupancyInput,
  flatCreateInput,
  flatEditInput,
  idSchema,
  towerCreateInput,
  towerEditInput,
} from '@portl/contracts';
import type { PortlAuth } from '../auth/auth.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { DomainError, type Actor } from '../registry/context.js';
import { structureService } from './structure.js';
import { residentService } from './residents.js';
import { directoryService } from './directory.js';
import { administrationSummary } from './summary.js';
export function administrationRouter(auth: PortlAuth, db: PrismaClient) {
  const router = express.Router({ mergeParams: true }),
    structure = structureService(db),
    residents = residentService(db),
    directory = directoryService(db);
  const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const result = schema.safeParse(value);
    if (!result.success)
      throw new DomainError(
        422,
        'VALIDATION_ERROR',
        'Check the form details and try again',
      );
    return result.data;
  };
  const actor = (res: express.Response) => res.locals.actor as Actor;
  const sid = (req: express.Request) => parse(idSchema, req.params.societyId);
  const id = (req: express.Request) => parse(idSchema, req.params.id);
  router.use(async (req, res, next) => {
    if (!/^\/(administration(?:\/|$)|directory(?:\/|$))/.test(req.path))
      return next('router');
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
        req.method === 'GET' ? 'administration-read' : 'administration-write',
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
  router.use(express.json({ limit: '8kb' }));
  router.get('/administration/summary', async (req, res) => {
    parse(z.strictObject({}), req.query);
    res.json(await administrationSummary(db, actor(res), sid(req)));
  });
  router.get('/administration/towers', async (req, res) =>
    res.json(
      await structure.towers(
        actor(res),
        sid(req),
        parse(administrationQuery, req.query),
      ),
    ),
  );
  router.get('/administration/flats', async (req, res) =>
    res.json(
      await structure.flats(
        actor(res),
        sid(req),
        parse(administrationQuery, req.query),
      ),
    ),
  );
  router.post('/administration/towers', async (req, res) =>
    res
      .status(201)
      .json(
        await structure.createTower(
          actor(res),
          sid(req),
          parse(towerCreateInput, req.body),
        ),
      ),
  );
  router.post('/administration/flats', async (req, res) =>
    res
      .status(201)
      .json(
        await structure.createFlat(
          actor(res),
          sid(req),
          parse(flatCreateInput, req.body),
        ),
      ),
  );
  router.post('/administration/towers/:id/edit', async (req, res) =>
    res.json(
      await structure.editTower(
        actor(res),
        sid(req),
        id(req),
        parse(towerEditInput, req.body),
      ),
    ),
  );
  router.post('/administration/flats/:id/edit', async (req, res) =>
    res.json(
      await structure.editFlat(
        actor(res),
        sid(req),
        id(req),
        parse(flatEditInput, req.body),
      ),
    ),
  );
  router.post('/administration/towers/:id/archive', async (req, res) =>
    res.json(
      await structure.archiveTower(
        actor(res),
        sid(req),
        id(req),
        parse(archiveInput, req.body).expectedVersion,
      ),
    ),
  );
  router.post('/administration/flats/:id/archive', async (req, res) =>
    res.json(
      await structure.archiveFlat(
        actor(res),
        sid(req),
        id(req),
        parse(archiveInput, req.body).expectedVersion,
      ),
    ),
  );
  router.get('/administration/residents', async (req, res) =>
    res.json(
      await residents.list(
        actor(res),
        sid(req),
        parse(administrationQuery, req.query),
      ),
    ),
  );
  router.post('/administration/occupancies/:id/end', async (req, res) =>
    res.json(
      await residents.end(
        actor(res),
        sid(req),
        id(req),
        parse(endOccupancyInput, req.body).expectedStartedAt,
      ),
    ),
  );
  router.get('/directory', async (req, res) =>
    res.json(
      await directory.list(
        actor(res),
        sid(req),
        parse(directoryQuery, req.query),
      ),
    ),
  );
  router.post('/administration/directory', async (req, res) =>
    res
      .status(201)
      .json(
        await directory.create(
          actor(res),
          sid(req),
          parse(directoryCreateInput, req.body),
        ),
      ),
  );
  router.post('/administration/directory/:id/edit', async (req, res) =>
    res.json(
      await directory.edit(
        actor(res),
        sid(req),
        id(req),
        parse(directoryEditInput, req.body),
      ),
    ),
  );
  router.post('/administration/directory/:id/archive', async (req, res) =>
    res.json(
      await directory.archive(
        actor(res),
        sid(req),
        id(req),
        parse(archiveInput, req.body).expectedVersion,
      ),
    ),
  );
  return router;
}
