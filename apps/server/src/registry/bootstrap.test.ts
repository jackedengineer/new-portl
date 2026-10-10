import { describe, expect, it } from 'vitest';
import { bootstrapInput, bootstrapSocieties } from './bootstrap.js';
import { createDatabase } from '../database/client.js';

const config = {
  adminEmail: 'operator@example.invalid',
  adminName: 'Demo Admin',
  societies: [
    {
      name: 'Demo',
      code: 'DEMOA1B2C3D4',
      towers: [{ name: 'A', flats: ['101'] }],
    },
  ],
};
describe('controlled demo bootstrap', () => {
  it('refuses duplicate society codes, towers and flats', () => {
    expect(
      bootstrapInput.safeParse({
        ...config,
        societies: [config.societies[0], config.societies[0]],
      }).success,
    ).toBe(false);
    expect(
      bootstrapInput.safeParse({
        ...config,
        societies: [
          {
            ...config.societies[0],
            towers: [{ name: 'A', flats: ['101', '101'] }],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it('cannot grant administrator access without authenticator confirmation', async () => {
    const db = createDatabase('postgresql://unused:unused@localhost:1/unused');
    await expect(
      bootstrapSocieties(
        db,
        'test-secret-at-least-32-characters',
        bootstrapInput.parse(config),
        'test-totp-secret',
        'invalid',
      ),
    ).rejects.toThrow('Authenticator confirmation failed');
    await db.$disconnect();
  });
});
