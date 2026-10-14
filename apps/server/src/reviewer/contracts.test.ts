import { expect, it } from 'vitest';
import {
  POLICY_VERSION,
  reviewerSignInInput,
  reviewerReauthInput,
} from '@portl/contracts';
import { reviewerKeyHash, verifyReviewerKey } from './proof.js';

const acceptance = {
  adult: true,
  termsVersion: POLICY_VERSION,
  privacyVersion: POLICY_VERSION,
};
it('requires an exclusive role, bounded key and explicit current policy/review acknowledgement', () => {
  const valid = {
    role: 'RESIDENT',
    accessKey: 'a'.repeat(43),
    policyAcceptance: acceptance,
    reviewAcknowledged: true,
  };
  expect(reviewerSignInInput.safeParse(valid).success).toBe(true);
  for (const change of [
    { role: 'OWNER' },
    { accessKey: '123456' },
    { accessKey: 'a'.repeat(44) },
    { reviewAcknowledged: false },
    { policyAcceptance: { ...acceptance, privacyVersion: 'old' } },
    { userId: 'someone-else' },
    { societyId: 'real-society' },
  ])
    expect(reviewerSignInInput.safeParse({ ...valid, ...change }).success).toBe(
      false,
    );
  expect(
    reviewerReauthInput.safeParse({ accessKey: valid.accessKey }).success,
  ).toBe(true);
  expect(
    reviewerReauthInput.safeParse({
      accessKey: valid.accessKey,
      userId: 'other',
    }).success,
  ).toBe(false);
});
it('binds private key digests to the operator root and identity, without retaining raw keys', () => {
  const secret = 'test-root-secret-with-32-characters',
    key = 'a'.repeat(43);
  const digest = reviewerKeyHash(secret, 'resident', key);
  expect(digest).not.toContain(key);
  expect(verifyReviewerKey(secret, 'resident', key, digest)).toBe(true);
  expect(verifyReviewerKey(secret, 'guard', key, digest)).toBe(false);
  expect(verifyReviewerKey('different-root', 'resident', key, digest)).toBe(
    false,
  );
  expect(verifyReviewerKey(secret, 'resident', 'b'.repeat(43), digest)).toBe(
    false,
  );
  expect(verifyReviewerKey(secret, 'resident', key, 'malformed')).toBe(false);
});
