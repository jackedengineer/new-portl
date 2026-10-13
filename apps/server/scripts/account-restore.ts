import { createDatabase } from '../src/database/client.js';
import { restoreAccountErasures } from '../src/account/restore.js';
const [flag, path] = process.argv.slice(2);
if (flag !== '--offline-restore' || !path || !process.env.DIRECT_DATABASE_URL)
  throw new Error(
    'Usage: account-restore.ts --offline-restore /absolute/private/ledger-directory; stop API and worker first',
  );
const db = createDatabase(process.env.DIRECT_DATABASE_URL);
try {
  const queued = await restoreAccountErasures(db, path);
  console.log(
    `Reapplied ${queued} account erasures. Complete restore acceptance checks before reopening access.`,
  );
} finally {
  await db.$disconnect();
}
