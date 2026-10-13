import { expect, it } from 'vitest';
import { accountProof } from './proof.js';
it('binds OTP proof to challenge, account and email and never accepts another purpose or malformed code', () => {
  const proof = accountProof('test-only-secret-at-least-thirty-two-characters');
  const challenge = { id: 'c1', userId: 'u1', email: 'one@example.com' };
  const digest = proof.digest(challenge, '123456');
  expect(proof.verify(challenge, '123456', digest)).toBe(true);
  expect(proof.verify(challenge, '654321', digest)).toBe(false);
  expect(proof.verify({ ...challenge, id: 'c2' }, '123456', digest)).toBe(
    false,
  );
  expect(proof.verify({ ...challenge, userId: 'u2' }, '123456', digest)).toBe(
    false,
  );
  expect(
    proof.verify({ ...challenge, email: 'two@example.com' }, '123456', digest),
  ).toBe(false);
  expect(proof.verify(challenge, '123456', 'bad')).toBe(false);
});
