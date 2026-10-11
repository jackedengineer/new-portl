import { DomainError } from '../registry/context.js';

type State = {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  version: number;
  expiresAt: Date;
  approvedUntil: Date | null;
  visit: { exitedAt: Date | null } | null;
};
const changed = () =>
  new DomainError(
    409,
    'STATE_CHANGED',
    'This request changed. Refresh to see its current status.',
  );
const expired = () =>
  new DomainError(
    409,
    'REQUEST_EXPIRED',
    'This request or approval has expired. Register a new arrival.',
  );
export function requestStatus(row: State, now: Date, approvalCurrent: boolean) {
  if (row.status === 'PENDING' && row.expiresAt <= now) return 'EXPIRED';
  if (row.status === 'APPROVED' && !row.visit) {
    if (!row.approvedUntil || row.approvedUntil <= now) return 'EXPIRED';
    if (!approvalCurrent) return 'INVALIDATED';
  }
  return row.status;
}
export function assertDecision(row: State, version: number, now: Date) {
  if (row.version !== version || row.status !== 'PENDING') throw changed();
  if (row.expiresAt <= now) throw expired();
}
export function assertEntry(
  row: State,
  version: number,
  now: Date,
  approvalCurrent: boolean,
) {
  if (row.version !== version || row.status !== 'APPROVED' || row.visit)
    throw changed();
  if (!row.approvedUntil || row.approvedUntil <= now) throw expired();
  if (!approvalCurrent)
    throw new DomainError(
      409,
      'APPROVAL_INVALIDATED',
      'Resident approval is no longer valid. Register a new arrival.',
    );
}
export function assertExit(
  row: Pick<State, 'version' | 'visit'>,
  version: number,
) {
  if (row.version !== version || !row.visit || row.visit.exitedAt)
    throw changed();
}
