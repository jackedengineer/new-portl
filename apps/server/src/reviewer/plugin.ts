import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { reviewerSignInInput, reviewerReauthInput } from '@portl/contracts';
import type { reviewerService } from './service.js';
import { DomainError } from '../registry/context.js';

type Service = ReturnType<typeof reviewerService>;
export function reviewerPlugin(service: Service, origins: string[]) {
  const origin = (headers?: Headers) => {
    if (
      !origins.includes(
        headers?.get('origin') || headers?.get('expo-origin') || '',
      )
    )
      throw new APIError('FORBIDDEN', {
        message: 'Request origin not allowed',
      });
  };
  const failure = (error: unknown): never => {
    if (error instanceof DomainError)
      throw new APIError('UNAUTHORIZED', { message: error.message });
    throw error;
  };
  return {
    id: 'portl-reviewer',
    endpoints: {
      reviewerSignIn: createAuthEndpoint(
        '/reviewer/sign-in',
        { method: 'POST', body: reviewerSignInInput },
        async (ctx) => {
          origin(ctx.headers);
          let sessionToken: string | undefined;
          try {
            const credential = await service.credential(
              ctx.body.role,
              ctx.body.accessKey,
            );
            const user = await ctx.context.internalAdapter.findUserById(
              credential.userId,
            );
            if (!user)
              throw new APIError('UNAUTHORIZED', {
                message:
                  'Review access is unavailable or the key is incorrect.',
              });
            const session = await ctx.context.internalAdapter.createSession(
              user.id,
            );
            if (!session)
              throw new APIError('UNAUTHORIZED', {
                message: 'Could not create a review session.',
              });
            sessionToken = session.token;
            await service.finishSignIn(credential, session.id);
            await setSessionCookie(ctx, { session, user });
            return ctx.json({ success: true });
          } catch (error) {
            if (sessionToken)
              await ctx.context.internalAdapter.deleteSession(sessionToken);
            return failure(error);
          }
        },
      ),
      reviewerReauthenticate: createAuthEndpoint(
        '/reviewer/reauthenticate',
        { method: 'POST', body: reviewerReauthInput, use: [sessionMiddleware] },
        async (ctx) => {
          origin(ctx.headers);
          const session = ctx.context.session;
          if (ctx.headers?.get('x-portl-expected-user') !== session.user.id)
            throw new APIError('UNAUTHORIZED', {
              message: 'Your account changed. Reopen this screen.',
            });
          try {
            return ctx.json(
              await service.reauthenticate(
                session.user.id,
                session.session.id,
                ctx.body.accessKey,
              ),
            );
          } catch (error) {
            return failure(error);
          }
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
