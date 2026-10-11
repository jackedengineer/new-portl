import { DomainError } from '../registry/context.js';
type State = {
  version: number;
  validFrom: Date;
  validUntil: Date;
  revokedAt: Date | null;
  visit: { exitedAt: Date | null } | null;
};
const changed = () =>
  new DomainError(
    409,
    'PASS_UNAVAILABLE',
    'This pass is unavailable. Refresh to see its current status.',
  );
export function passStatus(row: State, at: Date, current: boolean) {
  if (row.visit) return row.visit.exitedAt ? 'COMPLETED' : 'INSIDE';
  if (row.revokedAt) return 'REVOKED';
  if (row.validUntil <= at) return 'EXPIRED';
  if (!current) return 'INVALIDATED';
  return row.validFrom > at ? 'SCHEDULED' : 'READY';
}
export function assertPassEntry(
  row: State,
  version: number,
  at: Date,
  current: boolean,
) {
  if (row.version !== version || passStatus(row, at, current) !== 'READY')
    throw changed();
}
export function assertPassRevoke(row: State, version: number) {
  if (row.version !== version || row.visit || row.revokedAt) throw changed();
}
export function assertPassWindow(from: Date, until: Date, at: Date) {
  const duration = until.getTime() - from.getTime(),
    start = from.getTime() - at.getTime();
  if (
    !Number.isFinite(duration) ||
    !Number.isFinite(start) ||
    duration < 900000 ||
    duration > 86400000 ||
    start < -300000 ||
    start > 604800000 ||
    until <= at
  )
    throw new DomainError(
      422,
      'INVALID_WINDOW',
      'Choose a start within seven days and a window of 15 minutes to 24 hours.',
    );
}
