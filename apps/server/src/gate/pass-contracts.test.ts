import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  guestPassCreateInput,
  guestPassCode,
  guestPassEntryInput,
} from '@portl/contracts';
const input = {
  intentId: randomUUID(),
  flatId: 'flat',
  visitorName: ' Test Guest ',
  validFrom: '2026-10-11T12:00:00Z',
  validUntil: '2026-10-11T13:00:00Z',
};
it('accepts only minimal resident pass fields and a bounded visit window', () => {
  expect(guestPassCreateInput.parse(input).visitorName).toBe('Test Guest');
  for (const extra of [
    { issuerId: 'other' },
    { status: 'READY' },
    { code: '0000000000000000' },
    { phone: '9999999999' },
  ])
    expect(guestPassCreateInput.safeParse({ ...input, ...extra }).success).toBe(
      false,
    );
  expect(
    guestPassCreateInput.safeParse({ ...input, validUntil: input.validFrom })
      .success,
  ).toBe(false);
  expect(
    guestPassCreateInput.safeParse({
      ...input,
      validUntil: '2026-10-13T12:00:00Z',
    }).success,
  ).toBe(false);
});
it('normalizes readable codes without accepting arbitrary credentials', () => {
  expect(guestPassCode.parse(' abcd-efgh-jkmn-pqrs ')).toBe('ABCDEFGHJKMNPQRS');
  for (const invalid of [
    '123456',
    'a'.repeat(100),
    'https://evil.example/pass',
    'ABCD/EFGH/JKMN/PQRS',
  ])
    expect(guestPassCode.safeParse(invalid).success).toBe(false);
});
it('requires the presented code again at physical entry', () => {
  const movement = {
    intentId: randomUUID(),
    expectedVersion: 1,
    gateId: 'gate',
  };
  expect(guestPassEntryInput.safeParse(movement).success).toBe(false);
  expect(
    guestPassEntryInput.safeParse({ ...movement, code: 'ABCDEFGHJKMNPQRS' })
      .success,
  ).toBe(true);
});
