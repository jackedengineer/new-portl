import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';
import { postgresOptions } from './connection.js';

export function createDatabase(url: string) {
  return new PrismaClient({
    adapter: new PrismaPg(postgresOptions(url), { schema: 'portl_auth' }),
  });
}

export async function assertRestrictedRuntime(db: PrismaClient) {
  const [role] = await db.$queryRaw<{ unsafe: boolean }[]>`
    SELECT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb
      OR EXISTS (SELECT 1 FROM pg_tables WHERE schemaname IN ('portl_auth', 'portl_registry') AND tableowner = current_user)
      OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('portl_auth', 'portl_registry') AND nspowner = r.oid)) AS unsafe
    FROM pg_roles r WHERE rolname = current_user
  `;
  if (!role || role.unsafe)
    throw new Error('Database runtime role must have restricted privileges');
}
