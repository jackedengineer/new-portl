import type { PoolConfig } from 'pg';

export function postgresOptions(
  connectionString: string,
): PoolConfig & { connectionString: string } {
  const url = new URL(connectionString);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  for (const option of [...url.searchParams.keys()]) {
    if (option.startsWith('ssl') || option === 'uselibpqcompat')
      url.searchParams.delete(option);
  }
  return {
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: true },
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  };
}
