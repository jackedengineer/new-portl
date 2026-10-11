import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  deviceRegistrationInput,
  notificationListQuery,
  notificationTapInput,
} from '@portl/contracts';
it('rejects supplied identity, tenant and arbitrary notification destinations', () => {
  const input = {
    installationId: randomUUID(),
    token: 'ExponentPushToken[abc_DEF-123]',
    platform: 'android',
  };
  expect(deviceRegistrationInput.parse(input)).toEqual(input);
  for (const extra of [
    { userId: 'other' },
    { sessionId: 'other' },
    { societyId: 'other' },
  ])
    expect(
      deviceRegistrationInput.safeParse({ ...input, ...extra }).success,
    ).toBe(false);
  expect(
    deviceRegistrationInput.safeParse({
      ...input,
      token: 'https://attacker.invalid',
    }).success,
  ).toBe(false);
  expect(
    notificationTapInput.safeParse({
      notificationId: randomUUID(),
      url: 'portl://admin',
    }).success,
  ).toBe(false);
  expect(
    notificationTapInput.safeParse({ notificationId: '../../admin' }).success,
  ).toBe(false);
});
it('bounds inbox pagination and rejects client-owned read status', () => {
  expect(notificationListQuery.parse({})).toEqual({});
  expect(notificationListQuery.safeParse({ take: 10000 }).success).toBe(false);
  expect(
    notificationListQuery.safeParse({ readAt: new Date().toISOString() })
      .success,
  ).toBe(false);
});
