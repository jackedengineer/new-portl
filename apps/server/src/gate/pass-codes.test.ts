import { expect, it } from 'vitest';
import { passCodes } from './pass-codes.js';
const codes = passCodes('a'.repeat(64));
const context = ['society', 'pass', 'issuer'] as const;
it('generates independent 80-bit readable codes with context-bound authenticated encryption', () => {
  const a = codes.create(context),
    b = codes.create(context);
  expect(a.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
  expect(a.code).not.toBe(b.code);
  expect(a.cipherText).not.toContain(a.code);
  expect(codes.reveal(a.cipherText, context)).toBe(a.code);
  expect(codes.digest(a.code)).toBe(a.tokenHash);
  expect(() =>
    codes.reveal(a.cipherText, ['society', 'other', 'issuer']),
  ).toThrow();
  expect(() =>
    passCodes('b'.repeat(64)).reveal(a.cipherText, context),
  ).toThrow();
  const parts = a.cipherText.split('.');
  parts[2] = 'AAAAAAAAAAAAAAAAAAAAAA';
  expect(() => codes.reveal(parts.join('.'), context)).toThrow();
});
it('rejects weak keys and malformed ciphertext', () => {
  expect(() => passCodes('short')).toThrow();
  for (const value of ['', 'v2.a.b.c', 'v1.a.b.c'])
    expect(() => codes.reveal(value, context)).toThrow();
});
