import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import pg from 'pg';
import {
  independentLedgerUrl,
  databaseLedger,
} from '../src/account/database-ledger.js';
import { postgresOptions } from '../src/database/connection.js';

// Offline owner operation. The owner URL must never be installed in Render.
async function main() {
  const [flag, output] = process.argv.slice(2);
  const ownerUrl = process.env.ERASURE_LEDGER_OWNER_URL,
    business = process.env.DIRECT_DATABASE_URL;
  if (
    flag !== '--private-output' ||
    !output ||
    !isAbsolute(output) ||
    !ownerUrl ||
    !business
  )
    throw new Error(
      'Provide independent ERASURE_LEDGER_OWNER_URL, business DIRECT_DATABASE_URL and --private-output /absolute/new/ignored.env',
    );
  independentLedgerUrl(ownerUrl, business);
  const owner = new pg.Client(postgresOptions(ownerUrl));
  const role = `portl_ledger_${randomBytes(8).toString('hex')}`,
    password = randomBytes(48).toString('base64url');
  let worker: pg.Pool | undefined;
  await owner.connect();
  try {
    const { rows } = await owner.query(
      "SELECT to_regnamespace('portl_auth') IS NOT NULL AS business",
    );
    if (rows[0]?.business)
      throw new Error('Ledger project must not contain the business schema');
    await owner.query('BEGIN');
    try {
      await owner.query(
        await readFile(
          new URL('../sql/erasure-ledger.sql', import.meta.url),
          'utf8',
        ),
      );
      await owner.query(
        `CREATE ROLE ${pg.escapeIdentifier(role)} LOGIN PASSWORD ${pg.escapeLiteral(password)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`,
      );
      await owner.query(
        `GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(decodeURIComponent(new URL(ownerUrl).pathname.slice(1)))} TO ${pg.escapeIdentifier(role)}`,
      );
      await owner.query(
        `GRANT USAGE ON SCHEMA portl_erasure_ledger TO ${pg.escapeIdentifier(role)}`,
      );
      await owner.query(
        `GRANT EXECUTE ON FUNCTION portl_erasure_ledger.persist(jsonb),portl_erasure_ledger.cleanup() TO ${pg.escapeIdentifier(role)}`,
      );
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
    const runtime = new URL(ownerUrl);
    runtime.username = role;
    runtime.password = password;
    worker = new pg.Pool({ ...postgresOptions(runtime.toString()), max: 1 });
    await databaseLedger(worker).assertReady();
    await writeFile(
      output,
      `ERASURE_LEDGER_DATABASE_URL="${runtime.toString()}"\n`,
      { mode: 0o600, flag: 'wx' },
    );
    console.log(
      'Independent ledger provisioned and restricted credentials verified; secrets saved only in the private output file.',
    );
  } finally {
    await worker?.end();
    await owner.end();
  }
}
void main().catch(() => {
  console.error(
    'Erasure ledger operation failed; credentials withheld. Verify independent project access and the private output/source paths.',
  );
  process.exitCode = 1;
});
