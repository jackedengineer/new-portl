import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';
import { postgresOptions } from './connection.js';

const pools = new WeakMap<PrismaClient, pg.Pool>();
export function createDatabase(url: string) {
  const pool = new pg.Pool(postgresOptions(url));
  const db = new PrismaClient({
    adapter: new PrismaPg(pool, {
      schema: 'portl_auth',
      disposeExternalPool: true,
    }),
  });
  pools.set(db, pool);
  return db;
}
export function databasePool(db: PrismaClient) {
  const pool = pools.get(db);
  if (!pool) throw new Error('Database connection pool unavailable');
  return pool;
}

export async function assertRestrictedRuntime(db: PrismaClient) {
  const [role] = await db.$queryRaw<{ unsafe: boolean }[]>`
    SELECT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb
      OR EXISTS (SELECT 1 FROM pg_tables WHERE schemaname IN ('portl_auth', 'portl_registry', 'portl_gate', 'portl_notifications', 'portl_jobs', 'portl_community') AND tableowner = current_user)
      OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('portl_auth', 'portl_registry', 'portl_gate', 'portl_notifications', 'portl_jobs', 'portl_community') AND nspowner = r.oid)) AS unsafe
    FROM pg_roles r WHERE rolname = current_user
  `;
  if (!role || role.unsafe)
    throw new Error('Database runtime role must have restricted privileges');
}
