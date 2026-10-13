import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

export type Actor = {
  userId: string;
  email: string;
  sessionId: string;
  requestId: string;
};
export type Tx = Prisma.TransactionClient;
export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export async function scope(tx: Tx, societyId: string) {
  await tx.$queryRaw`SELECT set_config('portl.society_id', ${societyId}, true)`;
}
export function withActor<T>(
  db: PrismaClient,
  actor: Actor,
  work: (tx: Tx) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      // Serialize in-flight domain work with account/session revocation and erasure.
      const active = await tx.$queryRaw<
        { id: string }[]
      >`SELECT u.id FROM portl_auth."User" u JOIN portl_auth."Session" s ON s."userId"=u.id WHERE u.id=${actor.userId} AND s.id=${actor.sessionId} AND u."deletionRequestedAt" IS NULL AND s."expiresAt">clock_timestamp() FOR SHARE OF u,s`;
      if (!active.length)
        throw new DomainError(401, 'UNAUTHENTICATED', 'Sign in to continue');
      await tx.$queryRaw`SELECT set_config('portl.user_id', ${actor.userId}, true),
      set_config('portl.session_id', ${actor.sessionId}, true), set_config('portl.email', ${actor.email}, true),
      set_config('portl.society_id', '', true), set_config('portl.invite_hash', '', true), set_config('portl.join_hash', '', true)`;
      return work(tx);
    },
    { timeout: 15_000 },
  );
}
export async function requireAdmin(tx: Tx, actor: Actor, societyId: string) {
  await scope(tx, societyId);
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM portl_registry."Membership"
    WHERE "societyId" = ${societyId} AND "userId" = ${actor.userId} AND role = 'ADMIN' AND active FOR SHARE`;
  if (!rows.length)
    throw new DomainError(403, 'FORBIDDEN', 'Society admin access is required');
  const assurance = await tx.adminAssurance.findUnique({
    where: { sessionId: actor.sessionId },
  });
  if (!assurance || assurance.expiresAt <= new Date())
    throw new DomainError(
      403,
      'ADMIN_STEP_UP_REQUIRED',
      'Verify your authenticator to continue',
    );
  const society = await tx.society.findFirst({
    where: { id: societyId, archived: false },
  });
  if (!society)
    throw new DomainError(404, 'NOT_FOUND', 'Society not available');
}
export async function audit(
  tx: Tx,
  actor: Actor,
  societyId: string,
  action: string,
  resourceId: string,
) {
  // No RETURNING: residents may append an event but cannot read the admin audit timeline.
  await tx.$executeRaw`INSERT INTO portl_registry."RegistryAudit" (id, "societyId", "actorId", action, "resourceId", "requestId", "createdAt")
    VALUES (${randomUUID()}, ${societyId}, ${actor.userId}, ${action}, ${resourceId}, ${actor.requestId}, now())`;
}
