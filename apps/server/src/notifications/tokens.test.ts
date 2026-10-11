import { expect, it } from 'vitest';
import { tokenCipher } from './tokens.js';
it('encrypts tokens with a purpose-separated key and binds them to registration generation', () => {
  const c = tokenCipher('test-only-long-root-secret-for-notifications');
  const raw = 'ExponentPushToken[private-token]';
  const sealed = c.seal(raw, 'installation', 'generation');
  expect(sealed).not.toContain(raw);
  expect(c.open(sealed, 'installation', 'generation')).toBe(raw);
  expect(() => c.open(sealed, 'installation', 'old-generation')).toThrow();
  expect(() =>
    tokenCipher('other-long-secret-notifications-only').open(
      sealed,
      'installation',
      'generation',
    ),
  ).toThrow();
  expect(c.seal(raw, 'installation', 'generation')).not.toBe(sealed);
});
