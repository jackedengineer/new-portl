import { createDatabase } from '../src/database/client.js';
import { restoreAccountErasures } from '../src/account/restore.js';
import { readLedger } from '../src/account/ledger.js';
import {
  independentLedgerUrl,
  readDatabaseLedger,
} from '../src/account/database-ledger.js';
import { postgresOptions } from '../src/database/connection.js';
import pg from 'pg';
const [flag, path] = process.argv.slice(2);
if (flag !== '--offline-restore' || !path || !process.env.DIRECT_DATABASE_URL)
  throw new Error(
    'Usage: account-restore.ts --offline-restore /absolute/private/ledger-directory|database; stop API and worker first. Database source requires ERASURE_LEDGER_OWNER_URL.',
  );
const db = createDatabase(process.env.DIRECT_DATABASE_URL);
let ledgerClient: pg.Pool | undefined;
try {
  if (path === 'database') {
    if (!process.env.ERASURE_LEDGER_OWNER_URL)
      throw new Error(
        'Independent ledger owner URL required for offline restore',
      );
    ledgerClient = new pg.Pool({
      ...postgresOptions(
        independentLedgerUrl(
          process.env.ERASURE_LEDGER_OWNER_URL,
          process.env.DIRECT_DATABASE_URL,
        ),
      ),
      max: 1,
    });
  }
  const queued = await restoreAccountErasures(
    db,
    ledgerClient ? readDatabaseLedger(ledgerClient) : readLedger(path),
  );
  console.log(
    `Reapplied ${queued} account erasures. Complete restore acceptance checks before reopening access.`,
  );
} finally {
  await db.$disconnect();
  await ledgerClient?.end();
}
