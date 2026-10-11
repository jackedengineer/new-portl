import { describe, expect, it } from 'vitest';
import {
  assertDecision,
  assertEntry,
  assertExit,
  requestStatus,
} from './state.js';

const now = new Date('2026-10-11T10:00:00Z');
const pending = {
  status: 'PENDING' as const,
  version: 1,
  expiresAt: new Date(now.getTime() + 60_000),
  approvedUntil: null,
  visit: null,
};
const approved = {
  ...pending,
  status: 'APPROVED' as const,
  version: 2,
  approvedUntil: new Date(now.getTime() + 30 * 60_000),
};
describe('visitor decisions and physical presence', () => {
  it('never approves on timeout, including the exact expiry boundary', () => {
    expect(requestStatus(pending, now, true)).toBe('PENDING');
    const expired = { ...pending, expiresAt: now };
    expect(requestStatus(expired, now, true)).toBe('EXPIRED');
    expect(() => assertDecision(expired, 1, now)).toThrow('expired');
    expect(() => assertEntry(expired, 1, now, true)).toThrow();
  });
  it('allows one pending decision and rejects stale versions and terminal states', () => {
    expect(() => assertDecision(pending, 1, now)).not.toThrow();
    expect(() => assertDecision(pending, 2, now)).toThrow('changed');
    for (const status of ['APPROVED', 'REJECTED', 'CANCELLED'] as const)
      expect(() => assertDecision({ ...pending, status }, 1, now)).toThrow();
  });
  it('requires current unexpired approval for entry', () => {
    expect(() => assertEntry(approved, 2, now, true)).not.toThrow();
    expect(() => assertEntry(approved, 2, now, false)).toThrow('valid');
    expect(requestStatus(approved, now, false)).toBe('INVALIDATED');
    expect(() =>
      assertEntry({ ...approved, approvedUntil: now }, 2, now, true),
    ).toThrow('expired');
    expect(() =>
      assertEntry({ ...approved, status: 'REJECTED' }, 2, now, true),
    ).toThrow();
  });
  it('keeps presence valid after the entry window and requires entry before exit', () => {
    expect(() => assertExit(approved, 2)).toThrow();
    const inside = { ...approved, version: 3, visit: { exitedAt: null } };
    expect(
      requestStatus(inside, new Date(now.getTime() + 86400_000), false),
    ).toBe('APPROVED');
    expect(() => assertEntry(inside, 3, now, true)).toThrow();
    expect(() => assertExit(inside, 3)).not.toThrow();
    expect(() => assertExit(inside, 2)).toThrow('changed');
    expect(() =>
      assertExit({ ...inside, visit: { exitedAt: now } }, 3),
    ).toThrow();
  });
});
