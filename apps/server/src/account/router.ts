import { sharedReviewAccount } from '../reviewer/service.js';
import {
  recoveryEnrollInput,
  recoveryConfirmInput,
  reviewCodeInput,
} from '@portl/contracts';
import express from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import {
  deletionProofInput,
  deletionStartInput,
  deletionStatusInput,
  policyAcceptanceInput,
  revokeSessionInput,
} from '@portl/contracts';
import type { z } from 'zod';
import type { PortlAuth } from '../auth/auth.js';
import { DomainError } from '../registry/context.js';
export function parseAccount<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new DomainError(
      422,
      'VALIDATION_ERROR',
      'Check the form details and try again',
    );
  return result.data;
}
export async function accountBudget(
  auth: PortlAuth,
  subject: string,
  bucket: string,
  max: number,
  seconds: number,
) {
  if (!(await auth.budget(subject, bucket, max, seconds)))
    throw new DomainError(
      429,
      'RATE_LIMITED',
      'Please wait before trying again',
    );
}
export async function deletionAction(
  auth: PortlAuth,
  action: string,
  input: unknown,
  ip: string,
) {
  if (action === 'start') {
    const { email } = parseAccount(deletionStartInput, input);
    auth.lifecycle.assertDeletionEmail(email);
  }
  await accountBudget(auth, ip, 'account-public', 30, 60);
  if (action === 'start') {
    const { email } = parseAccount(deletionStartInput, input);
    await accountBudget(auth, ip, 'deletion-send-ip', 5, 3600);
    await accountBudget(auth, email, 'deletion-send-hour', 5, 3600);
    await accountBudget(auth, email, 'deletion-send-minute', 1, 60);
    return auth.accounts.startDeletion(email);
  }
  if (action === 'confirm')
    return auth.accounts.confirmDeletion(
      parseAccount(deletionProofInput, input),
    );
  if (action === 'status')
    return auth.accounts.deletionStatus(
      parseAccount(deletionStatusInput, input).receiptToken,
    );
  throw new DomainError(404, 'NOT_FOUND', 'Page not found');
}
export function accountRouter(auth: PortlAuth) {
  const router = express.Router();
  router.use((req, _res, next) => {
    if (req.method !== 'GET') {
      const origin = req.get('origin') || req.get('expo-origin');
      if (!origin || !auth.acceptsOrigin(origin))
        throw new DomainError(
          403,
          'UNTRUSTED_ORIGIN',
          'Request origin not allowed',
        );
      if (!req.is('application/json'))
        throw new DomainError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'Use application/json',
        );
    }
    next();
  });
  router.use(express.json({ limit: '8kb' }));
  router.post('/deletion/:action', async (req, res) =>
    res.json(
      await auth.lifecycleRequest(fromNodeHeaders(req.headers), () =>
        deletionAction(
          auth,
          String(req.params.action),
          req.body,
          req.ip || '127.0.0.1',
        ),
      ),
    ),
  );
  router.use(async (req, res, next) => {
    const session = await auth.accountSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session?.user.emailVerified)
      throw new DomainError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    if (req.get('x-portl-expected-user') !== session.user.id)
      throw new DomainError(
        409,
        'IDENTITY_CHANGED',
        'Your account changed. Reopen this screen.',
      );
    if (
      req.path.startsWith('/recovery') &&
      ((await auth.reviewer.identity(session.user.id)) ||
        (await auth.lifecycle.identity(session.user.id)))
    )
      throw sharedReviewAccount();
    await accountBudget(auth, session.user.id, 'account-private', 30, 60);
    res.locals.session = session;
    next();
  });
  router.post('/review-code', async (req, res) => {
    const session = res.locals.session as NonNullable<
      Awaited<ReturnType<PortlAuth['accountSession']>>
    >;
    const { purpose } = parseAccount(reviewCodeInput, req.body);
    res.json(await auth.lifecycle.code(session, purpose));
  });
  router.get('/recovery', async (_req, res) => {
    const session = res.locals.session as NonNullable<
      Awaited<ReturnType<PortlAuth['accountSession']>>
    >;
    res.json(await auth.recovery.status(session.user.id, session.session.id));
  });
  router.post('/recovery/enroll', async (req, res) => {
    const { id } = parseAccount(recoveryEnrollInput, req.body);
    const session = res.locals.session as NonNullable<
      Awaited<ReturnType<PortlAuth['accountSession']>>
    >;
    res.json(
      await auth.recovery.enroll(session.user.id, session.session.id, id),
    );
  });
  router.post('/recovery/confirm', async (req, res) => {
    const input = parseAccount(recoveryConfirmInput, req.body);
    const session = res.locals.session as NonNullable<
      Awaited<ReturnType<PortlAuth['accountSession']>>
    >;
    res.json(
      await auth.recovery.confirm(session.user.id, session.session.id, input),
    );
  });
  router.post('/accept-policy', async (req, res) => {
    parseAccount(policyAcceptanceInput, req.body);
    const session = res.locals.session as NonNullable<
      Awaited<ReturnType<PortlAuth['accountSession']>>
    >;
    res.json(await auth.accounts.accept(session.user.id, session.session.id));
  });
  router.get('/sessions', async (_req, res) => {
    const session = res.locals.session as NonNullable<
      Awaited<ReturnType<PortlAuth['accountSession']>>
    >;
    res.json(await auth.accounts.sessions(session.user.id, session.session.id));
  });
  router.post('/sessions/revoke', async (req, res) => {
    const { sessionId } = parseAccount(revokeSessionInput, req.body);
    const session = res.locals.session as NonNullable<
      Awaited<ReturnType<PortlAuth['accountSession']>>
    >;
    res.json(
      await auth.accounts.revoke(
        session.user.id,
        session.session.id,
        sessionId,
      ),
    );
  });
  return router;
}
