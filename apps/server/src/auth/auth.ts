import { createHmac } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import { prismaAdapter } from '@better-auth/prisma-adapter';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
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
    handler(request: Request) {
      return delivery.run({ failed: false }, async () => {
        const response = await auth.handler(request);
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
