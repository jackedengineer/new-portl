import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import type { GateSubscription } from '@portl/contracts';
import type { PortlAuth } from '../auth/auth.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { DomainError, withActor } from '../registry/context.js';
import { recipient, requireView } from './access.js';

export function gateLiveAccess(auth: PortlAuth, db: PrismaClient) {
  return async (
    headers: IncomingHttpHeaders,
    subscription: GateSubscription,
    requestId?: string,
  ) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(headers),
    });
    if (!session?.user.emailVerified || session.user.id !== subscription.userId)
      throw new DomainError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    const actor = {
      userId: session.user.id,
      email: session.user.email,
      sessionId: session.session.id,
      requestId: randomUUID(),
    };
    return withActor(db, actor, async (tx) => {
      await requireView(tx, actor, subscription.societyId, subscription.view);
      if (
        subscription.view === 'RESIDENT' &&
        !(await tx.occupancy.findFirst({
          where: {
            societyId: subscription.societyId,
            userId: actor.userId,
            endedAt: null,
          },
          select: { id: true },
        }))
      )
        throw new DomainError(
          403,
          'FORBIDDEN',
          'Current residency is required',
        );
      if (!requestId) return true;
      if (
        subscription.view === 'RESIDENT' &&
        !(await recipient(tx, subscription.societyId, requestId, actor.userId))
      )
        return false;
      return !!(await tx.visitorRequest.findFirst({
        where: { id: requestId, societyId: subscription.societyId },
        select: { id: true },
      }));
    });
  };
}
