import { createHmac } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import { prismaAdapter } from '@better-auth/prisma-adapter';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { expo } from '@better-auth/expo';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { consumeBudget } from './budget.js';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { z } from 'zod';

import type { AuthEnv } from '../config/auth-env.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { allowEmailSend } from './throttle.js';

export type OtpDelivery = (message: {
  email: string;
  otp: string;
}) => Promise<void>;

export const authRoutes = new Map([
  ['/email-otp/send-verification-otp', 'POST'],
  ['/sign-in/email-otp', 'POST'],
  ['/get-session', 'GET'],
  ['/sign-out', 'POST'],
  ['/two-factor/verify-totp', 'POST'],
]);

export function createAuth(
  db: PrismaClient,
  env: AuthEnv,
  deliver: OtpDelivery,
) {
  const delivery = new AsyncLocalStorage<{ failed: boolean }>();
  const digest = (otp: string) =>
    createHmac('sha256', env.BETTER_AUTH_SECRET)
      .update(`otp:${otp}`)
      .digest('base64url');
  const auth = betterAuth({
    appName: 'Portl',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(db, { provider: 'postgresql', transaction: true }),
    emailAndPassword: { enabled: false },
    trustedOrigins: env.TRUSTED_ORIGINS,
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: 'portl',
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: ['x-portl-client-ip'] },
    },
    // HTTP logging records only request ID, method and status in the Express boundary.
    logger: { disabled: true },
    telemetry: { enabled: false },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/email-otp/send-verification-otp': { window: 60, max: 3 },
        '/sign-in/email-otp': { window: 600, max: 10 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!authRoutes.has(ctx.path))
          throw new APIError('NOT_FOUND', { message: 'Route not found' });
        if (
          ctx.path === '/email-otp/send-verification-otp' ||
          ctx.path === '/sign-in/email-otp'
        ) {
          const email = z
            .string()
            .max(254)
            .toLowerCase()
            .pipe(z.email())
            .safeParse(ctx.body?.email);
          if (!email.success)
            throw new APIError('BAD_REQUEST', {
              message: 'Invalid email address',
            });
          ctx.body.email = email.data;
          if (ctx.path === '/email-otp/send-verification-otp') {
            if (ctx.body.type !== 'sign-in')
              throw new APIError('BAD_REQUEST', {
                message: 'Invalid OTP purpose',
              });
            if (
              !(await allowEmailSend(db, env.BETTER_AUTH_SECRET, email.data))
            ) {
              throw new APIError('TOO_MANY_REQUESTS', {
                message: 'Please wait before requesting another code',
              });
            }
          } else if (
            !z
              .string()
              .regex(/^\d{6}$/)
              .safeParse(ctx.body.otp).success
          ) {
            throw new APIError('BAD_REQUEST', {
              message: 'Enter the six-digit code',
            });
          }
        }
      }),
    },
    plugins: [
      expo(),
      twoFactor({ issuer: 'Portl', allowPasswordless: true }),
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        disableSignUp: false,
        resendStrategy: 'rotate',
        storeOTP: { hash: async (otp) => digest(otp) },
        async sendVerificationOTP({ email, otp }) {
          const identifier = `sign-in-otp-${email}`;
          const hashPrefix = `${digest(otp)}:`;
          let expiresAt: Date | undefined;
          try {
            const challenge = await db.verification.findFirst({
              where: { identifier, value: `${hashPrefix}0` },
              select: { expiresAt: true },
            });
            if (!challenge) throw new Error('Email challenge unavailable');
            expiresAt = challenge.expiresAt;
            await deliver({ email, otp });
          } catch {
            const attempt = delivery.getStore();
            if (attempt) attempt.failed = true;
            // A wrong attempt recreates the row with another ID/counter. Match its original expiry and digest.
            if (expiresAt)
              await db.verification.deleteMany({
                where: {
                  identifier,
                  expiresAt,
                  value: { startsWith: hashPrefix },
                },
              });
            throw new APIError('SERVICE_UNAVAILABLE', {
              message: 'Unable to send a code. Please try again later.',
            });
          }
        },
      }),
    ],
  });
  return {
    api: { getSession: auth.api.getSession },
    acceptsOrigin: (origin: string) => env.TRUSTED_ORIGINS.includes(origin),
    budget: (subject: string, bucket: string, max: number, seconds: number) =>
      consumeBudget(db, env.BETTER_AUTH_SECRET, subject, bucket, max, seconds),
    handler(request: Request) {
      return delivery.run({ failed: false }, async () => {
        let adminSession: Awaited<ReturnType<typeof auth.api.getSession>> =
          null;
        let codeDigest = '';
        if (new URL(request.url).pathname.endsWith('/two-factor/verify-totp')) {
          adminSession = await auth.api.getSession({
            headers: request.headers,
          });
          if (!adminSession)
            return Response.json(
              { code: 'UNAUTHENTICATED', message: 'Sign in to continue' },
              { status: 401 },
            );
          const input = z
            .strictObject({
              code: z.string().regex(/^\d{6}$/),
              trustDevice: z.literal(false).optional(),
            })
            .safeParse(
              await request
                .clone()
                .json()
                .catch(() => null),
            );
          if (!input.success)
            return Response.json(
              {
                code: 'INVALID_CODE',
                message: 'Enter a six-digit authenticator code',
              },
              { status: 400 },
            );
          const configured = await db.twoFactor.findUnique({
            where: { userId: adminSession.user.id },
          });
          if (!configured?.verified || !adminSession.user.twoFactorEnabled)
            return Response.json(
              {
                code: 'AUTHENTICATOR_NOT_CONFIGURED',
                message: 'Contact the operator to configure your authenticator',
              },
              { status: 403 },
            );
          if (
            !(await consumeBudget(
              db,
              env.BETTER_AUTH_SECRET,
              adminSession.user.id,
              'admin-totp-minute',
              5,
              60,
            )) ||
            !(await consumeBudget(
              db,
              env.BETTER_AUTH_SECRET,
              adminSession.user.id,
              'admin-totp-hour',
              15,
              3600,
            ))
          )
            return Response.json(
              {
                code: 'TOO_MANY_ATTEMPTS',
                message: 'Please wait before trying another authenticator code',
              },
              { status: 429 },
            );
          codeDigest = digest(
            `totp:${adminSession.user.id}:${input.data.code}`,
          );
        }
        const response = await auth.handler(request);
        if (adminSession && response.ok) {
          await db.adminTotpUse.deleteMany({
            where: {
              userId: adminSession.user.id,
              expiresAt: { lte: new Date() },
            },
          });
          const claims = await db.$queryRaw<
            { userId: string }[]
          >`INSERT INTO portl_auth."AdminTotpUse" ("userId", digest, "expiresAt")
            VALUES (${adminSession.user.id}, ${codeDigest}, now() + interval '90 seconds')
            ON CONFLICT ("userId", digest) DO UPDATE SET "expiresAt" = EXCLUDED."expiresAt"
            WHERE portl_auth."AdminTotpUse"."expiresAt" <= now() RETURNING "userId"`;
          if (!claims.length)
            return Response.json(
              {
                code: 'CODE_ALREADY_USED',
                message: 'Wait for a new authenticator code',
              },
              { status: 409 },
            );
          await db.adminAssurance.upsert({
            where: { sessionId: adminSession.session.id },
            create: {
              sessionId: adminSession.session.id,
              expiresAt: new Date(Date.now() + 15 * 60_000),
            },
            update: { expiresAt: new Date(Date.now() + 15 * 60_000) },
          });
        }
        if (!delivery.getStore()?.failed) return response;
        // Better Auth catches delivery callback errors. Report failure at the HTTP boundary.
        return Response.json(
          {
            code: 'EMAIL_DELIVERY_UNAVAILABLE',
            message: 'Unable to send a code. Please try again later.',
          },
          { status: 503, headers: { 'retry-after': '60' } },
        );
      });
    },
  };
}

export type PortlAuth = ReturnType<typeof createAuth>;
