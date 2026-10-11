import type { GateView } from '@portl/contracts';
import {
  DomainError,
  requireAdmin,
  scope,
  type Actor,
  type Tx,
} from '../registry/context.js';
export const missing = () =>
  new DomainError(404, 'NOT_FOUND', 'Visitor request not available');
export async function now(tx: Tx) {
  const [row] = await tx.$queryRaw<
    { at: Date }[]
  >`SELECT clock_timestamp() AS at`;
  return row!.at;
}
export async function requireView(
  tx: Tx,
  actor: Actor,
  sid: string,
  view: GateView,
  gateId?: string,
) {
  await scope(tx, sid);
  if (view === 'ADMIN') return requireAdmin(tx, actor, sid);
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM portl_registry."Membership" WHERE "societyId"=${sid} AND "userId"=${actor.userId} AND role::text=${view} AND active FOR SHARE`;
  if (!rows.length)
    throw new DomainError(
      403,
      'FORBIDDEN',
      `${view === 'GUARD' ? 'Assigned guard' : 'Resident'} access is required`,
    );
  if (!(await tx.society.findFirst({ where: { id: sid, archived: false } })))
    throw missing();
  if (view === 'GUARD') {
    const assignments = await tx.$queryRaw<
      { id: string }[]
    >`SELECT a.id FROM portl_registry."GuardAssignment" a JOIN portl_registry."Gate" g ON g.id=a."gateId" AND g."societyId"=a."societyId" WHERE a."societyId"=${sid} AND a."userId"=${actor.userId} AND a.active AND g.active AND (${gateId ?? null}::text IS NULL OR g.id=${gateId ?? null}) FOR SHARE OF a,g`;
    if (!assignments.length)
      throw new DomainError(
        403,
        'FORBIDDEN',
        'An active assignment to this gate is required',
      );
  }
}
export async function recipient(
  tx: Tx,
  sid: string,
  rid: string,
  uid: string,
  lock = false,
) {
  // A row lock keeps membership and the original occupancy valid through the command commit.
  const rows = lock
    ? await tx.$queryRaw<
        { id: string }[]
      >`SELECT o.id FROM portl_gate."RequestRecipient" r JOIN portl_registry."Occupancy" o ON o.id=r."occupancyId" AND o."societyId"=r."societyId" AND o."userId"=r."userId" AND o."startedAt"=r."occupancyStartedAt" AND o."endedAt" IS NULL JOIN portl_registry."Membership" m ON m."societyId"=r."societyId" AND m."userId"=r."userId" AND m.role='RESIDENT' AND m.active WHERE r."societyId"=${sid} AND r."requestId"=${rid} AND r."userId"=${uid} FOR SHARE OF o,m`
    : await tx.$queryRaw<
        { id: string }[]
      >`SELECT 1 AS id WHERE portl_gate.is_recipient(${sid},${rid},${uid})`;
  return rows.length > 0;
}
export async function approvalCurrent(tx: Tx, sid: string, rid: string) {
  const [r] = await tx.$queryRaw<
    { valid: boolean }[]
  >`SELECT portl_gate.approval_current(${sid},${rid}) AS valid`;
  return !!r?.valid;
}
