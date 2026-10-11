import { assertRestrictedRuntime } from '../database/client.js';
import type { PrismaClient } from '../generated/prisma/client.js';
export async function assertNotificationWorker(db: PrismaClient) {
  await assertRestrictedRuntime(db);
  // Resolve catalog OIDs without requiring access to business schemas.
  const [privileges] = await db.$queryRaw<{ unsafe: boolean }[]>`
    SELECT count(*)<>2 OR bool_or(has_table_privilege(current_user,c.oid,'UPDATE')) AS unsafe
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname='portl_auth' AND c.relname='Session')
       OR (n.nspname='portl_gate' AND c.relname='VisitorRequest')
  `;
  if (!privileges || privileges.unsafe)
    throw new Error('Worker cannot have business write privileges');
}
