import { randomUUID } from 'node:crypto';
import type {
  ArrivalInput,
  GateCancelInput,
  GateCommand,
  GateDecisionInput,
  MovementInput,
} from '@portl/contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  audit,
  DomainError,
  hash,
  withActor,
  type Actor,
  type Tx,
} from '../registry/context.js';
import { missing, now, recipient, requireView } from './access.js';
import { assertDecision, assertEntry, assertExit } from './state.js';

async function command(
  tx: Tx,
  actor: Actor,
  sid: string,
  key: string,
  payload: unknown,
  work: () => Promise<GateCommand>,
) {
  // Serialize identical intents before observing the receipt. Unique PK is the final backstop.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([sid, actor.userId, key])},0))`;
  const where = {
    societyId_actorId_intentId: {
      societyId: sid,
      actorId: actor.userId,
      intentId: key,
    },
  };
  const inputHash = hash(JSON.stringify(payload));
  const previous = await tx.gateCommandReceipt.findUnique({ where });
  if (previous) {
    if (previous.inputHash !== inputHash)
      throw new DomainError(
        409,
        'INTENT_REUSED',
        'This action identifier was used for different details',
      );
    return { requestId: previous.requestId, version: previous.version };
  }
  const result = await work();
  await tx.gateCommandReceipt.create({
    data: {
      societyId: sid,
      actorId: actor.userId,
      intentId: key,
      inputHash,
      ...result,
    },
  });
  return result;
}
export function gateCommands(db: PrismaClient) {
  return {
    register: (actor: Actor, sid: string, input: ArrivalInput) =>
      withActor(db, actor, async (tx) => {
        await requireView(tx, actor, sid, 'GUARD', input.gateId);
        return command(
          tx,
          actor,
          sid,
          input.intentId,
          ['register', input],
          async () => {
            const flats = await tx.$queryRaw<
              { id: string }[]
            >`SELECT id FROM portl_registry."Flat" WHERE "societyId"=${sid} AND id=${input.flatId} AND NOT archived FOR SHARE`;
            if (!flats.length)
              throw new DomainError(
                404,
                'FLAT_UNAVAILABLE',
                'Choose an active flat in this society',
              );
            const occupants = await tx.$queryRaw<
              { id: string; userId: string; startedAt: Date }[]
            >`SELECT o.id,o."userId",o."startedAt" FROM portl_registry."Occupancy" o JOIN portl_registry."Membership" m ON m."societyId"=o."societyId" AND m."userId"=o."userId" AND m.role='RESIDENT' AND m.active WHERE o."societyId"=${sid} AND o."flatId"=${input.flatId} AND o."endedAt" IS NULL FOR SHARE OF o,m`;
            if (!occupants.length)
              throw new DomainError(
                409,
                'NO_RESIDENT',
                'This flat has no current resident to receive the request',
              );
            const at = await now(tx);
            const id = randomUUID();
            await tx.visitorRequest.create({
              data: {
                id,
                societyId: sid,
                gateId: input.gateId,
                flatId: input.flatId,
                visitorName: input.visitorName,
                category: input.category,
                company: input.company || null,
                createdBy: actor.userId,
                createdAt: at,
                expiresAt: new Date(at.getTime() + 600000),
              },
            });
            await tx.requestRecipient.createMany({
              data: occupants.map((o) => ({
                societyId: sid,
                requestId: id,
                userId: o.userId,
                occupancyId: o.id,
                occupancyStartedAt: o.startedAt,
              })),
            });
            await audit(tx, actor, sid, 'VISITOR_REQUESTED', id);
            return { requestId: id, version: 1 };
          },
        );
      }),
    act: (
      actor: Actor,
      sid: string,
      id: string,
      kind: 'decision' | 'cancel' | 'entry' | 'exit',
      input: GateDecisionInput | GateCancelInput | MovementInput,
    ) =>
      withActor(db, actor, async (tx) => {
        await requireView(
          tx,
          actor,
          sid,
          kind === 'decision' ? 'RESIDENT' : 'GUARD',
          'gateId' in input ? input.gateId : undefined,
        );
        if (
          kind === 'decision' &&
          !(await recipient(tx, sid, id, actor.userId, true))
        )
          throw missing();
        return command(
          tx,
          actor,
          sid,
          input.intentId,
          [kind, id, input],
          async () => {
            const rows = await tx.$queryRaw<
              { id: string }[]
            >`SELECT id FROM portl_gate."VisitorRequest" WHERE "societyId"=${sid} AND id=${id} FOR UPDATE`;
            if (!rows.length) throw missing();
            const row = await tx.visitorRequest.findUniqueOrThrow({
              where: { id },
              include: { visit: true },
            });
            let at = await now(tx);
            if (
              kind === 'decision' &&
              !(await tx.flat.findFirst({
                where: { id: row.flatId, societyId: sid, archived: false },
              }))
            )
              throw new DomainError(
                409,
                'FLAT_UNAVAILABLE',
                'The destination flat is no longer active',
              );
            if (kind === 'entry') {
              const flat = await tx.$queryRaw<
                { id: string }[]
              >`SELECT id FROM portl_registry."Flat" WHERE id=${row.flatId} AND "societyId"=${sid} AND NOT archived FOR SHARE`;
              if (!flat.length)
                throw new DomainError(
                  409,
                  'FLAT_UNAVAILABLE',
                  'The destination flat is no longer active',
                );
            }
            if (kind === 'decision') {
              assertDecision(row, input.expectedVersion, at);
              const approved =
                'decision' in input && input.decision === 'APPROVE';
              await tx.visitorRequest.update({
                where: { id },
                data: {
                  status: approved ? 'APPROVED' : 'REJECTED',
                  decidedBy: actor.userId,
                  decidedAt: at,
                  approvedUntil: approved
                    ? new Date(at.getTime() + 1800000)
                    : null,
                  version: { increment: 1 },
                },
              });
            } else if (kind === 'cancel') {
              assertDecision(row, input.expectedVersion, at);
              await tx.visitorRequest.update({
                where: { id },
                data: { status: 'CANCELLED', version: { increment: 1 } },
              });
            } else if (kind === 'entry' && 'gateId' in input) {
              const current =
                !!row.decidedBy &&
                (await recipient(tx, sid, id, row.decidedBy, true));
              // Authority locks may wait past expiry; validate against time after acquiring them.
              at = await now(tx);
              assertEntry(row, input.expectedVersion, at, current);
              const visit = await tx.visit.create({
                data: {
                  societyId: sid,
                  requestId: id,
                  enteredAt: at,
                  enteredBy: actor.userId,
                },
              });
              await tx.movementEvent.create({
                data: {
                  societyId: sid,
                  visitId: visit.id,
                  type: 'ENTRY',
                  gateId: input.gateId,
                  actorId: actor.userId,
                  createdAt: at,
                },
              });
              await tx.visitorRequest.update({
                where: { id },
                data: { version: { increment: 1 } },
              });
            } else if (kind === 'exit' && 'gateId' in input) {
              assertExit(row, input.expectedVersion);
              await tx.visit.update({
                where: { id: row.visit!.id },
                data: { exitedAt: at, exitedBy: actor.userId },
              });
              await tx.movementEvent.create({
                data: {
                  societyId: sid,
                  visitId: row.visit!.id,
                  type: 'EXIT',
                  gateId: input.gateId,
                  actorId: actor.userId,
                  createdAt: at,
                },
              });
              await tx.visitorRequest.update({
                where: { id },
                data: { version: { increment: 1 } },
              });
            }
            await audit(tx, actor, sid, `VISITOR_${kind.toUpperCase()}`, id);
            return { requestId: id, version: row.version + 1 };
          },
        );
      }),
  };
}
