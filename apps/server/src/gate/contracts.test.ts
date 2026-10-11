import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  arrivalInput,
  gateDecisionInput,
  movementInput,
  gateListQuery,
  guardAssignmentInput,
} from '@portl/contracts';

const intentId = randomUUID();
it('validates minimal arrival context and rejects authority injection', () => {
  const input = {
    intentId,
    gateId: 'gate',
    flatId: 'flat',
    visitorName: '  A Visitor  ',
    category: 'DELIVERY',
    company: '  Parcel Co  ',
  };
  expect(arrivalInput.parse(input).visitorName).toBe('A Visitor');
  expect(arrivalInput.parse(input).company).toBe('Parcel Co');
  for (const extra of [
    { status: 'APPROVED' },
    { societyId: 'other' },
    { createdBy: 'resident' },
    { phone: '9999999999' },
  ])
    expect(arrivalInput.safeParse({ ...input, ...extra }).success).toBe(false);
  expect(
    arrivalInput.safeParse({ ...input, category: 'STAFF_ALWAYS_ALLOWED' })
      .success,
  ).toBe(false);
  expect(
    arrivalInput.safeParse({ ...input, visitorName: 'a'.repeat(81) }).success,
  ).toBe(false);
  expect(
    arrivalInput.safeParse({ ...input, intentId: 'not-an-intent' }).success,
  ).toBe(false);
});
it('requires exact decision, intent and expected version', () => {
  expect(
    gateDecisionInput.parse({
      intentId,
      expectedVersion: 1,
      decision: 'APPROVE',
    }).decision,
  ).toBe('APPROVE');
  expect(
    gateDecisionInput.safeParse({
      intentId,
      expectedVersion: 0,
      decision: 'APPROVE',
    }).success,
  ).toBe(false);
  expect(
    gateDecisionInput.safeParse({
      intentId,
      expectedVersion: 1,
      decision: 'AUTO_APPROVE',
    }).success,
  ).toBe(false);
  expect(
    movementInput.safeParse({ intentId, expectedVersion: 2 }).success,
  ).toBe(false);
});
it('bounds list/search inputs and keeps assignments email-bound', () => {
  expect(gateListQuery.parse({ view: 'GUARD' }).filter).toBe('WAITING');
  expect(gateListQuery.safeParse({ view: 'GUARD', take: 9999 }).success).toBe(
    false,
  );
  expect(
    guardAssignmentInput.parse({ email: ' Guard@Example.com ', gateId: 'gate' })
      .email,
  ).toBe('guard@example.com');
  expect(
    guardAssignmentInput.safeParse({
      email: 'x@y.com',
      gateId: 'gate',
      role: 'ADMIN',
    }).success,
  ).toBe(false);
});
