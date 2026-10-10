import { randomBytes } from 'node:crypto';
import type {
  ApplicationInput,
  DecisionInput,
  InvitationInput,
} from '@portl/contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  audit,
  DomainError,
  hash,
  requireAdmin,
  scope,
  withActor,
  type Actor,
  type Tx,
} from './context.js';
import { grantResident } from './grants.js';
import {
  applicationInclude,
  applicationView,
  flatView,
  invitationView,
  societyView,
} from './projections.js';

const unavailable = () =>
  new DomainError(404, 'NOT_FOUND', 'This request is unavailable');
const conflict = () =>
  new DomainError(
    409,
    'ALREADY_PROCESSED',
    'This request has already been processed. Refresh to see its status.',
  );
async function validFlat(tx: Tx, societyId: string, flatId: string) {
  const flat = await tx.flat.findFirst({
    where: { id: flatId, societyId, archived: false },
    include: { tower: true },
  });
  if (!flat) throw unavailable();
  return flat;
}
async function pendingInvitation(tx: Tx, actor: Actor, token: string) {
  const tokenHash = hash(token);
  await tx.$queryRaw`SELECT set_config('portl.invite_hash', ${tokenHash}, true)`;
  const found = await tx.invitation.findUnique({ where: { tokenHash } });
  if (!found || found.email !== actor.email) throw unavailable();
  await scope(tx, found.societyId);
  await tx.$queryRaw`SELECT id FROM portl_registry."Invitation" WHERE id = ${found.id} FOR UPDATE`;
  const row = await tx.invitation.findUnique({
    where: { id: found.id },
    include: { society: true, flat: { include: { tower: true } } },
  });
  if (
    !row ||
    row.acceptedAt ||
    row.revokedAt ||
    row.expiresAt <= new Date() ||
    row.society.archived ||
    row.flat.archived
  )
    throw unavailable();
  // Keep the grantor's current authority locked through consumption and grant.
  const grantor = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM portl_registry."Membership" WHERE "societyId" = ${row.societyId}
    AND "userId" = ${row.createdBy} AND role = 'ADMIN' AND active FOR SHARE`;
  if (!grantor.length) throw unavailable();
  return row;
}
export function registryService(db: PrismaClient) {
  return {
    memberships: (actor: Actor) =>
      withActor(db, actor, async (tx) => {
        const grants = await tx.membership.findMany({
          where: { userId: actor.userId, active: true },
          orderBy: { societyId: 'asc' },
        });
        const result = [];
        for (const societyId of new Set(grants.map((g) => g.societyId))) {
          await scope(tx, societyId);
          const society = await tx.society.findFirst({
            where: { id: societyId, archived: false },
          });
          if (!society) continue;
          const occupancies = await tx.occupancy.findMany({
            where: {
              societyId,
              userId: actor.userId,
              endedAt: null,
              flat: { archived: false },
            },
            include: { flat: { include: { tower: true } } },
          });
          result.push({
            society: societyView(society),
            roles: grants
              .filter((g) => g.societyId === societyId)
              .map((g) => g.role),
            flats: occupancies.map((o) => ({
              ...flatView(o.flat),
              relationship: o.relationship,
            })),
          });
        }
        return result;
      }),
    lookup: (actor: Actor, code: string) =>
      withActor(db, actor, async (tx) => {
        await tx.$queryRaw`SELECT set_config('portl.join_hash', ${hash(code)}, true)`;
        const society = await tx.society.findFirst({
          where: { joinCodeHash: hash(code), archived: false },
        });
        if (!society)
          throw new DomainError(
            404,
            'SOCIETY_NOT_FOUND',
            'Check the society code with your society office',
          );
        await scope(tx, society.id);
        const flats = await tx.flat.findMany({
          where: { societyId: society.id, archived: false },
          include: { tower: true },
          orderBy: [{ tower: { name: 'asc' } }, { label: 'asc' }],
          take: 500,
        });
        return { society: societyView(society), flats: flats.map(flatView) };
      }),
    preview: (actor: Actor, token: string) =>
      withActor(db, actor, async (tx) => {
        const row = await pendingInvitation(tx, actor, token);
        return {
          society: societyView(row.society),
          flat: flatView(row.flat),
          relationship: row.relationship,
          expiresAt: row.expiresAt.toISOString(),
        };
      }),
    accept: (actor: Actor, token: string) =>
      withActor(db, actor, async (tx) => {
        const row = await pendingInvitation(tx, actor, token);
        await grantResident(
          tx,
          row.societyId,
          actor.userId,
          row.flatId,
          row.relationship,
        );
        await tx.invitation.update({
          where: { id: row.id },
          data: { acceptedAt: new Date(), acceptedBy: actor.userId },
        });
        await audit(tx, actor, row.societyId, 'INVITATION_ACCEPTED', row.id);
        return { societyId: row.societyId };
      }),
    apply: (actor: Actor, societyId: string, input: ApplicationInput) =>
      withActor(db, actor, async (tx) => {
        await scope(tx, societyId);
        const society = await tx.society.findFirst({
          where: {
            id: societyId,
            archived: false,
            joinCodeHash: hash(input.societyCode),
          },
        });
        if (!society) throw unavailable();
        await validFlat(tx, societyId, input.flatId);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${societyId + ':' + actor.userId}, 0))`;
        if (
          await tx.membership.findFirst({
            where: { societyId, userId: actor.userId, active: true },
          })
        )
          throw new DomainError(
            409,
            'ALREADY_MEMBER',
            'You already have access to this society',
          );
        const existing = await tx.residentApplication.findFirst({
          where: { societyId, userId: actor.userId, status: 'PENDING' },
        });
        if (existing)
          throw new DomainError(
            409,
            'APPLICATION_PENDING',
            'You already have an application awaiting review',
          );
        const row = await tx.residentApplication.create({
          data: {
            societyId,
            userId: actor.userId,
            name: input.name,
            flatId: input.flatId,
            relationship: input.relationship,
          },
          include: applicationInclude,
        });
        await audit(tx, actor, societyId, 'APPLICATION_SUBMITTED', row.id);
        return applicationView(row);
      }),
    applications: (actor: Actor, cursor?: string) =>
      withActor(db, actor, async (tx) => {
        // Flat/society joins need explicit tenant context; read the private rows first.
        const rows = await tx.residentApplication.findMany({
          where: { userId: actor.userId },
          orderBy: { id: 'asc' },
          take: 21,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        const items = [];
        for (const row of rows.slice(0, 20)) {
          await scope(tx, row.societyId);
          const full = await tx.residentApplication.findUniqueOrThrow({
            where: { id: row.id },
            include: applicationInclude,
          });
          items.push(applicationView(full));
        }
        return { items, nextCursor: rows.length > 20 ? rows[19]!.id : null };
      }),
    withdraw: (actor: Actor, id: string) =>
      withActor(db, actor, async (tx) => {
        const row = await tx.residentApplication.findFirst({
          where: { id, userId: actor.userId },
        });
        if (!row) throw unavailable();
        await scope(tx, row.societyId);
        const changed = await tx.residentApplication.updateMany({
          where: { id, userId: actor.userId, status: 'PENDING' },
          data: {
            status: 'WITHDRAWN',
            decidedAt: new Date(),
            decidedBy: actor.userId,
          },
        });
        if (!changed.count) throw conflict();
        await audit(tx, actor, row.societyId, 'APPLICATION_WITHDRAWN', id);
        return { success: true };
      }),
    adminFlats: (actor: Actor, societyId: string) =>
      withActor(db, actor, async (tx) => {
        await requireAdmin(tx, actor, societyId);
        const rows = await tx.flat.findMany({
          where: { societyId, archived: false },
          include: { tower: true },
          take: 500,
          orderBy: [{ tower: { name: 'asc' } }, { label: 'asc' }],
        });
        return { flats: rows.map(flatView) };
      }),
    invite: (actor: Actor, societyId: string, input: InvitationInput) =>
      withActor(db, actor, async (tx) => {
        await requireAdmin(tx, actor, societyId);
        await validFlat(tx, societyId, input.flatId);
        const token = randomBytes(32).toString('base64url');
        const row = await tx.invitation.create({
          data: {
            societyId,
            ...input,
            tokenHash: hash(token),
            createdBy: actor.userId,
            expiresAt: new Date(Date.now() + 7 * 86400_000),
          },
          include: { flat: { include: { tower: true } } },
        });
        await audit(tx, actor, societyId, 'INVITATION_CREATED', row.id);
        return { invitation: invitationView(row), token };
      }),
    invitations: (actor: Actor, societyId: string, cursor?: string) =>
      withActor(db, actor, async (tx) => {
        await requireAdmin(tx, actor, societyId);
        const rows = await tx.invitation.findMany({
          where: { societyId },
          orderBy: { id: 'asc' },
          take: 21,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: { flat: { include: { tower: true } } },
        });
        return {
          items: rows.slice(0, 20).map(invitationView),
          nextCursor: rows.length > 20 ? rows[19]!.id : null,
        };
      }),
    revoke: (actor: Actor, societyId: string, id: string) =>
      withActor(db, actor, async (tx) => {
        await requireAdmin(tx, actor, societyId);
        const changed = await tx.invitation.updateMany({
          where: { id, societyId, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (!changed.count) throw conflict();
        await audit(tx, actor, societyId, 'INVITATION_REVOKED', id);
        return { success: true };
      }),
    reviewQueue: (actor: Actor, societyId: string, cursor?: string) =>
      withActor(db, actor, async (tx) => {
        await requireAdmin(tx, actor, societyId);
        const rows = await tx.residentApplication.findMany({
          where: { societyId, status: 'PENDING' },
          orderBy: { id: 'asc' },
          take: 21,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: applicationInclude,
        });
        return {
          items: rows.slice(0, 20).map(applicationView),
          nextCursor: rows.length > 20 ? rows[19]!.id : null,
        };
      }),
    decide: (
      actor: Actor,
      societyId: string,
      id: string,
      input: DecisionInput,
    ) =>
      withActor(db, actor, async (tx) => {
        await requireAdmin(tx, actor, societyId);
        await tx.$queryRaw`SELECT id FROM portl_registry."ResidentApplication" WHERE id = ${id} AND "societyId" = ${societyId} FOR UPDATE`;
        const row = await tx.residentApplication.findFirst({
          where: { id, societyId },
        });
        if (!row) throw unavailable();
        if (row.status !== 'PENDING') throw conflict();
        if (input.decision === 'APPROVE')
          await grantResident(
            tx,
            societyId,
            row.userId,
            row.flatId,
            row.relationship,
          );
        await tx.residentApplication.update({
          where: { id },
          data: {
            status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            reason: input.decision === 'REJECT' ? input.reason : null,
            decidedAt: new Date(),
            decidedBy: actor.userId,
          },
        });
        await audit(
          tx,
          actor,
          societyId,
          input.decision === 'APPROVE'
            ? 'APPLICATION_APPROVED'
            : 'APPLICATION_REJECTED',
          id,
        );
        return { success: true };
      }),
  };
}
