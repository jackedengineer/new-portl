import { expect, it } from 'vitest';
import { operatorRecoveryInput } from './operator.js';
it('requires explicit operator checks and a society for no-admin recovery', () => {
  const input = {
    operation: 'RESTORE_ADMIN',
    targetEmail: 'admin@example.invalid',
    operatorId: 'operator-test',
    evidenceRef: 'case-test',
    identityVerified: true,
    societyAuthorityVerified: true,
  };
  expect(operatorRecoveryInput.safeParse(input).success).toBe(false);
  expect(
    operatorRecoveryInput.safeParse({ ...input, societyId: 'society-test' })
      .success,
  ).toBe(true);
  expect(
    operatorRecoveryInput.safeParse({
      ...input,
      societyId: 'society-test',
      identityVerified: false,
    }).success,
  ).toBe(false);
  expect(
    operatorRecoveryInput.safeParse({
      ...input,
      operation: 'RESET_AUTHENTICATOR',
    }).success,
  ).toBe(true);
});
