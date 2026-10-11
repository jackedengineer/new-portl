import { DomainError, hash, type Actor, type Tx } from '../registry/context.js';
type Result = { resourceId: string; version: number };
export async function executeGateCommand(
  tx: Tx,
  actor: Actor,
  sid: string,
  resourceKind: 'REQUEST' | 'PASS',
  key: string,
  payload: unknown,
  work: () => Promise<Result>,
) {
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
    if (
      previous.inputHash !== inputHash ||
      previous.resourceKind !== resourceKind
    )
      throw new DomainError(
        409,
        'INTENT_REUSED',
        'This action identifier was used for different details',
      );
    return { resourceId: previous.resourceId, version: previous.version };
  }
  const result = await work();
  await tx.gateCommandReceipt.create({
    data: {
      societyId: sid,
      actorId: actor.userId,
      intentId: key,
      inputHash,
      resourceKind,
      ...result,
    },
  });
  return result;
}
