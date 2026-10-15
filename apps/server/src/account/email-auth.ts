import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';
import { consumeBudget } from '../auth/budget.js';
import { allowEmailSend } from '../auth/throttle.js';
// These checks precede Better Auth's purpose-specific email OTP endpoints.
export async function checkEmailChange(
  request: Request,
  db: PrismaClient,
  secret: string,
  origins: string[],
  lifecycle: { permits: (email: string, purpose: 'change-email') => boolean },
  getSession: (input: {
    headers: Headers;
  }) => Promise<{ user: { id: string } } | null>,
) {
  const path = new URL(request.url).pathname;
  const emailChange =
    path.endsWith('/email-otp/request-email-change') ||
    path.endsWith('/email-otp/change-email');
  const rawBody: unknown =
    request.method === 'POST'
      ? await request
          .clone()
          .json()
          .catch(() => null)
      : null;
  const inputBody =
    rawBody && typeof rawBody === 'object'
      ? (rawBody as Record<string, unknown>)
      : {};
  const verifyCurrent =
    path.endsWith('/email-otp/send-verification-otp') &&
    inputBody.type === 'email-verification';
  if (emailChange || verifyCurrent) {
    const origin =
      request.headers.get('origin') || request.headers.get('expo-origin');
    if (!origin || !origins.includes(origin))
      return Response.json(
        { message: 'Request origin not allowed' },
        { status: 403 },
      );
    const current = await getSession({
      headers: request.headers,
    });
    const user = current
      ? await db.user.findUnique({ where: { id: current.user.id } })
      : null;
    if (!current || !user || user.deletionRequestedAt || !user.emailVerified)
      return Response.json({ message: 'Sign in to continue' }, { status: 401 });
    if (user.isReviewer)
      return Response.json(
        {
          code: 'SHARED_REVIEW_ACCOUNT',
          message: 'This shared fictional account is managed by the operator.',
        },
        { status: 403 },
      );
    if (request.headers.get('x-portl-expected-user') !== user.id)
      return Response.json(
        { message: 'Your account changed. Reopen this screen.' },
        { status: 409 },
      );
    if (verifyCurrent && inputBody.email !== user.email)
      return Response.json(
        { message: 'Verify your current account email' },
        { status: 400 },
      );
    if (
      emailChange &&
      typeof inputBody.newEmail === 'string' &&
      (inputBody.newEmail.toLowerCase().endsWith('@review.portl.invalid') ||
        inputBody.newEmail
          .toLowerCase()
          .endsWith('@lifecycle.review.portl.invalid')) &&
      !lifecycle.permits(inputBody.newEmail, 'change-email')
    )
      return Response.json(
        { message: 'This email address is reserved.' },
        { status: 400 },
      );
    if (
      emailChange &&
      user.isReviewLifecycle &&
      (typeof inputBody.newEmail !== 'string' ||
        !lifecycle.permits(inputBody.newEmail, 'change-email'))
    )
      return Response.json(
        { message: 'Use the allocated synthetic email address' },
        { status: 403 },
      );
    if (
      emailChange &&
      (!z.email().max(254).safeParse(inputBody.newEmail).success ||
        !z
          .string()
          .regex(/^\d{6}$/)
          .safeParse(inputBody.otp).success)
    )
      return Response.json(
        { message: 'Check the email and six-digit code' },
        { status: 400 },
      );
    if (
      !(await consumeBudget(
        db,
        secret,
        user.id,
        'email-change-verify',
        10,
        600,
      ))
    )
      return Response.json(
        { message: 'Please wait before trying again' },
        { status: 429 },
      );
    if (
      path.endsWith('/request-email-change') &&
      !(await allowEmailSend(
        db,
        secret,
        String(inputBody.newEmail).toLowerCase(),
      ))
    )
      return Response.json(
        { message: 'Please wait before requesting another code' },
        { status: 429 },
      );
  }
}
