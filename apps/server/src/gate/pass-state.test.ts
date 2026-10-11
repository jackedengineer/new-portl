import { expect, it } from 'vitest';
import {
  assertPassEntry,
  assertPassRevoke,
  assertPassWindow,
  passStatus,
} from './pass-state.js';
const now = new Date('2026-10-11T12:00:00Z');
const ready = {
  version: 1,
  validFrom: new Date('2026-10-11T11:59:00Z'),
  validUntil: new Date('2026-10-11T13:00:00Z'),
  revokedAt: null,
  visit: null,
};
it('distinguishes scheduled, ready, expired and invalidated permissions', () => {
  expect(passStatus(ready, now, true)).toBe('READY');
  expect(
    passStatus(
      { ...ready, validFrom: new Date('2026-10-11T12:01:00Z') },
      now,
      true,
    ),
  ).toBe('SCHEDULED');
  expect(passStatus({ ...ready, validUntil: now }, now, true)).toBe('EXPIRED');
  expect(passStatus(ready, now, false)).toBe('INVALIDATED');
});
it('keeps observed presence visible after validity or issuer authority ends', () => {
  expect(
    passStatus(
      { ...ready, visit: { exitedAt: null } },
      new Date('2027-01-01'),
      false,
    ),
  ).toBe('INSIDE');
  expect(passStatus({ ...ready, visit: { exitedAt: now } }, now, false)).toBe(
    'COMPLETED',
  );
});
it('rejects stale, premature, expired, revoked, invalidated and consumed entry', () => {
  expect(() => assertPassEntry(ready, 1, now, true)).not.toThrow();
  for (const row of [
    { ...ready, version: 2 },
    { ...ready, validFrom: new Date(now.getTime() + 1) },
    { ...ready, validUntil: now },
    { ...ready, revokedAt: now },
    { ...ready, visit: { exitedAt: null } },
  ])
    expect(() => assertPassEntry(row, 1, now, true)).toThrow();
  expect(() => assertPassEntry(ready, 1, now, false)).toThrow();
});
it('allows cancellation only before consumption with the current version', () => {
  expect(() => assertPassRevoke(ready, 1)).not.toThrow();
  expect(() =>
    assertPassRevoke({ ...ready, visit: { exitedAt: null } }, 1),
  ).toThrow();
  expect(() => assertPassRevoke({ ...ready, revokedAt: now }, 1)).toThrow();
  expect(() => assertPassRevoke(ready, 2)).toThrow();
});
it('bounds scheduling and window duration against authoritative time', () => {
  expect(() =>
    assertPassWindow(ready.validFrom, ready.validUntil, now),
  ).not.toThrow();
  for (const [from, until] of [
    [now, new Date(now.getTime() + 899999)],
    [now, new Date(now.getTime() + 86400001)],
    [new Date(now.getTime() + 604800001), new Date(now.getTime() + 608400001)],
    [new Date(now.getTime() - 300001), new Date(now.getTime() + 3600000)],
  ] as const)
    expect(() => assertPassWindow(from, until, now)).toThrow();
});
