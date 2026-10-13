import type { PrismaClient } from '../generated/prisma/client.js';
import {
  audit,
  DomainError,
  requireAdmin,
  withActor,
  type Actor,
  type Tx,
} from '../registry/context.js';
import { missing } from './access.js';
async function serializeGuard(tx: Tx, sid: string, uid: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['guard', sid, uid])},0))`;
  await tx.$queryRaw`SELECT id FROM portl_registry."Membership" WHERE "societyId"=${sid} AND "userId"=${uid} AND role='GUARD' FOR UPDATE`;
}
export function gateAdmin(db: PrismaClient) {
  return {
    createGate: (actor: Actor, sid: string, name: string) =>
      withActor(db, actor, async (tx) => {
        await requireAdmin(tx, actor, sid);
        // Unique society/name and ON CONFLICT make concurrent duplicate submissions harmless.
        await tx.gate.createMany({
          data: [{ societyId: sid, name }],
          skipDuplicates: true,
        });
        const gate = await tx.gate.findUniqueOrThrow({
          where: { societyId_name: { societyId: sid, name } },
        });
        await audit(tx, actor, sid, 'GATE_CONFIGURED', gate.id);
        return { id: gate.id, name: gate.name };
      }),
    assign: (
      actor: Actor,
      sid: string,
      input: { email: string; gateId: string },
    ) =>
      withActor(db, actor, async (tx) => {
        await requireAdmin(tx, actor, sid);
        if (
          !(await tx.gate.findFirst({
            where: { id: input.gateId, societyId: sid, active: true },
          }))
        )
          throw missing();
        const [user] = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM portl_auth."User" WHERE email=${input.email} AND "emailVerified" AND "deletionRequestedAt" IS NULL FOR SHARE`;
        if (!user)
          throw new DomainError(
            422,
            'VERIFIED_ACCOUNT_REQUIRED',
            'Ask the guard to sign in with this email first',
          );
        await serializeGuard(tx, sid, user.id);
        await tx.membership.upsert({
          where: {
            societyId_userId_role: {
              societyId: sid,
              userId: user.id,
              role: 'GUARD',
            },
          },
          create: { societyId: sid, userId: user.id, role: 'GUARD' },
          update: { active: true },
        });
        const assignment = await tx.guardAssignment.upsert({
          where: {
            societyId_gateId_userId: {
              societyId: sid,
              gateId: input.gateId,
              userId: user.id,
            },
          },
          create: {
            societyId: sid,
            gateId: input.gateId,
            userId: user.id,
            createdBy: actor.userId,
          },
          update: { active: true },
        });
        await audit(tx, actor, sid, 'GUARD_ASSIGNED', assignment.id);
        return { id: assignment.id };
      }),
    revoke: (actor: Actor, sid: string, id: string) =>
      withActor(db, actor, async (tx) => {
        await requireAdmin(tx, actor, sid);
        const row = await tx.guardAssignment.findFirst({
          where: { id, societyId: sid },
        });
        if (!row) throw missing();
        const subjects = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM portl_auth."User" WHERE id=${row.userId} AND "deletionRequestedAt" IS NULL FOR SHARE`;
        if (!subjects.length) throw missing();
        await serializeGuard(tx, sid, row.userId);
        await tx.guardAssignment.update({
          where: { id },
          data: { active: false },
        });
        if (
          !(await tx.guardAssignment.count({
            where: { societyId: sid, userId: row.userId, active: true },
          }))
        )
          await tx.membership.updateMany({
            where: { societyId: sid, userId: row.userId, role: 'GUARD' },
            data: { active: false },
          });
        await audit(tx, actor, sid, 'GUARD_REVOKED', id);
        return { id };
      }),
  };
}
