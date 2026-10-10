import { describe, expect, it } from 'vitest';
import { postgresOptions } from './connection.js';

describe('PostgreSQL TLS configuration', () => {
  it('enforces certificate verification for remote databases', () => {
    const result = postgresOptions(
      'postgresql://user:private@db.example.com/portl?sslmode=require',
    );
    expect(result.ssl).toEqual({ rejectUnauthorized: true });
    expect(new URL(result.connectionString!).searchParams.has('sslmode')).toBe(
      false,
    );
  });

  it('supports an isolated localhost test database without TLS', () => {
    expect(
      postgresOptions('postgresql://user:test@127.0.0.1:5432/test').ssl,
    ).toBe(false);
  });

  it('does not let a remote URL disable certificate verification', () => {
    expect(
      postgresOptions(
        'postgresql://user:private@db.example.com/portl?sslmode=disable',
      ).ssl,
    ).toEqual({ rejectUnauthorized: true });
  });
});
