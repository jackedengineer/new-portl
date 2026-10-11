import { DomainError, type Tx } from '../registry/context.js';
export const passMissing = () =>
  new DomainError(404, 'NOT_FOUND', 'Guest pass not available');
export async function isIssuer(tx: Tx, sid: string, id: string) {
  const [row] = await tx.$queryRaw<
    { valid: boolean }[]
  >`SELECT portl_gate.is_pass_issuer(${sid},${id}) AS valid`;
  return !!row?.valid;
}
export async function issuerCurrent(tx: Tx, sid: string, id: string) {
  const [row] = await tx.$queryRaw<
    { valid: boolean }[]
  >`SELECT portl_gate.pass_issuer_current(${sid},${id}) AS valid`;
  return !!row?.valid;
}
export async function lockIssuer(
  tx: Tx,
  sid: string,
  row: {
    occupancyId: string;
    occupancyStartedAt: Date;
    flatId: string;
    issuerId: string;
  },
) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT o.id FROM portl_registry."Occupancy" o JOIN portl_registry."Membership" m ON m."societyId"=o."societyId" AND m."userId"=o."userId" AND m.role='RESIDENT' AND m.active WHERE o.id=${row.occupancyId} AND o."societyId"=${sid} AND o."flatId"=${row.flatId} AND o."userId"=${row.issuerId} AND o."startedAt"=${row.occupancyStartedAt} AND o."endedAt" IS NULL FOR SHARE OF o,m`;
  return rows.length > 0;
}
export async function lockFlat(tx: Tx, sid: string, id: string) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM portl_registry."Flat" WHERE "societyId"=${sid} AND id=${id} AND NOT archived FOR SHARE`;
  if (!rows.length)
    throw new DomainError(
      409,
      'FLAT_UNAVAILABLE',
      'Choose an active flat in this society',
    );
}
