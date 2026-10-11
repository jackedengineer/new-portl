import {
  enqueueNotifications,
  withNotificationTransaction,
} from '../notifications/jobs.js';
import { randomUUID } from 'node:crypto';
import type {
  GuestPassCreate,
  GuestPassEntry,
  GuestPassExit,
  GuestPassRevoke,
} from '@portl/contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import { audit, DomainError, type Actor } from '../registry/context.js';
import { now, requireView } from './access.js';
import { isIssuer, lockFlat, lockIssuer, passMissing } from './pass-access.js';
import type { PassCodes } from './pass-codes.js';
import { executeGateCommand } from './intent.js';
import {
  assertPassEntry,
  assertPassRevoke,
  assertPassWindow,
} from './pass-state.js';
import { assertExit } from './state.js';
export function passCommands(db: PrismaClient, codes: PassCodes) {
  return {
    create: (actor: Actor, sid: string, input: GuestPassCreate) =>
      withNotificationTransaction(db, actor, async (tx) => {
        await requireView(tx, actor, sid, 'RESIDENT');
        await lockFlat(tx, sid, input.flatId);
        const occupants = await tx.$queryRaw<
          { id: string; startedAt: Date }[]
        >`SELECT id,"startedAt" FROM portl_registry."Occupancy" WHERE "societyId"=${sid} AND "flatId"=${input.flatId} AND "userId"=${actor.userId} AND "endedAt" IS NULL FOR SHARE`;
        const occupancy = occupants[0];
        if (!occupancy) throw passMissing();
        const result = await executeGateCommand(
          tx,
          actor,
          sid,
          'PASS',
          input.intentId,
          ['pass-create', input],
          async () => {
            const at = await now(tx),
              from = new Date(input.validFrom),
              until = new Date(input.validUntil);
            assertPassWindow(from, until, at);
            const id = randomUUID(),
              secret = codes.create([sid, id, actor.userId]);
            // INSERT without RETURNING: issuer read policy evaluates the committed row identity.
            await tx.$executeRaw`INSERT INTO portl_gate."GuestPass" (id,"societyId","flatId","issuerId","occupancyId","occupancyStartedAt","visitorName","validFrom","validUntil","createdAt","tokenHash","cipherText") VALUES (${id},${sid},${input.flatId},${actor.userId},${occupancy.id},${occupancy.startedAt},${input.visitorName},${from},${until},${at},${secret.tokenHash},${secret.cipherText})`;

            await audit(tx, actor, sid, 'GUEST_PASS_CREATED', id);
            return { resourceId: id, version: 1 };
          },
        );
        return { passId: result.resourceId, version: result.version };
      }),
    act: (
      actor: Actor,
      sid: string,
      id: string,
      kind: 'revoke' | 'entry' | 'exit',
      input: GuestPassRevoke | GuestPassEntry | GuestPassExit,
    ) =>
      withNotificationTransaction(db, actor, async (tx) => {
        await requireView(
          tx,
          actor,
          sid,
          kind === 'revoke' ? 'RESIDENT' : 'GUARD',
          'gateId' in input ? input.gateId : undefined,
        );
        if (kind === 'revoke' && !(await isIssuer(tx, sid, id)))
          throw passMissing();
        const result = await executeGateCommand(
          tx,
          actor,
          sid,
          'PASS',
          input.intentId,
          [`pass-${kind}`, id, input],
          async () => {
            const locked = await tx.$queryRaw<
              { id: string }[]
            >`SELECT id FROM portl_gate."GuestPass" WHERE "societyId"=${sid} AND id=${id} FOR UPDATE`;
            if (!locked.length) throw passMissing();
            const row = await tx.guestPass.findUniqueOrThrow({
              where: { id },
              include: { visit: true },
            });
            let at = await now(tx);
            if (kind === 'revoke') {
              if (
                row.issuerId !== actor.userId ||
                !(await lockIssuer(tx, sid, row))
              )
                throw passMissing();
              assertPassRevoke(row, input.expectedVersion);
              await tx.guestPass.update({
                where: { id },
                data: { revokedAt: at, version: { increment: 1 } },
              });
            } else if (kind === 'entry' && 'code' in input) {
              if (row.tokenHash !== codes.digest(input.code))
                throw passMissing();
              await lockFlat(tx, sid, row.flatId);
              const current = await lockIssuer(tx, sid, row);
              at = await now(tx); // Lock waits can cross the validity boundary.
              assertPassEntry(row, input.expectedVersion, at, current);
              const visit = await tx.visit.create({
                data: {
                  societyId: sid,
                  passId: id,
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
              await tx.guestPass.update({
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
              await tx.guestPass.update({
                where: { id },
                data: { version: { increment: 1 } },
              });
            } else
              throw new DomainError(
                422,
                'VALIDATION_ERROR',
                'Invalid pass action',
              );
            await audit(tx, actor, sid, `GUEST_PASS_${kind.toUpperCase()}`, id);
            if (kind !== 'revoke')
              await enqueueNotifications(
                db,
                tx,
                await tx.$queryRaw<
                  { id: string }[]
                >`SELECT * FROM portl_gate.notify_pass(${id})`,
              );
            return { resourceId: id, version: row.version + 1 };
          },
        );
        return { passId: result.resourceId, version: result.version };
      }),
  };
}
