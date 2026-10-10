import { describe, expect, it } from 'vitest';
import { parseAuthEnv } from './auth-env.js';

const input = {
  DATABASE_URL:
    'postgresql://runtime:private@db.example.com/portl?sslmode=require',
  BETTER_AUTH_SECRET: 'a'.repeat(48),
  BETTER_AUTH_URL: 'http://localhost:3000',
  TRUSTED_ORIGINS: 'portl://',
  RESEND_API_KEY: 're_private',
  EMAIL_FROM: 'Portl <auth@example.com>',
};

describe('authentication environment', () => {
  it('requires every active integration credential', () => {
    for (const key of Object.keys(input)) {
      expect(() =>
        parseAuthEnv({ ...input, [key]: '' }, 'development'),
      ).toThrow(key);
    }
  });

  it('does not include migration credentials in the runtime configuration', () => {
    const result = parseAuthEnv(
      { ...input, DIRECT_DATABASE_URL: 'admin-secret' },
      'development',
    );
    expect(result).not.toHaveProperty('DIRECT_DATABASE_URL');
  });

  it('rejects HTTP auth URLs in production', () => {
    expect(() => parseAuthEnv(input, 'production')).toThrow('BETTER_AUTH_URL');
  });

  it('rejects wildcard trusted origins', () => {
    expect(() =>
      parseAuthEnv({ ...input, TRUSTED_ORIGINS: '*' }, 'development'),
    ).toThrow('TRUSTED_ORIGINS');
  });

  it('accepts only HTTP(S) backend URLs without embedded credentials', () => {
    for (const url of [
      'ftp://localhost:3000',
      'http://user:password@localhost:3000',
    ]) {
      expect(() =>
        parseAuthEnv({ ...input, BETTER_AUTH_URL: url }, 'development'),
      ).toThrow('BETTER_AUTH_URL');
    }
  });

  it('rejects HTTP trusted origins in production', () => {
    expect(() =>
      parseAuthEnv(
        {
          ...input,
          BETTER_AUTH_URL: 'https://api.example.com',
          TRUSTED_ORIGINS: 'http://localhost:8081',
        },
        'production',
      ),
    ).toThrow('TRUSTED_ORIGINS');
  });

  it('reports field names without echoing invalid credentials', () => {
    expect(() =>
      parseAuthEnv({ ...input, DATABASE_URL: 'private-value' }, 'development'),
    ).toThrow('Invalid authentication environment: DATABASE_URL');
  });
});
