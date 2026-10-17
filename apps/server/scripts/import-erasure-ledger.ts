import pg from 'pg';
import { isAbsolute } from 'node:path';
import { readLedger, type LedgerEntry } from '../src/account/ledger.js';
import {
  databaseLedger,
  independentLedgerUrl,
} from '../src/account/database-ledger.js';
import { postgresOptions } from '../src/database/connection.js';

async function main() {
  const [flag, directory] = process.argv.slice(2);
  const runtime = process.env.ERASURE_LEDGER_DATABASE_URL,
    ownerUrl = process.env.ERASURE_LEDGER_OWNER_URL,
    business = process.env.DIRECT_DATABASE_URL;
  if (
    flag !== '--frozen-source' ||
    !directory ||
    !isAbsolute(directory) ||
    !runtime ||
    !ownerUrl ||
    !business
  )
    throw new Error(
      'Freeze and drain the old worker first; provide --frozen-source /private/ledger-directory and private ledger runtime/owner plus business URLs',
    );
  independentLedgerUrl(runtime, business);
  independentLedgerUrl(ownerUrl, business);
  if (
    new URL(runtime).hostname.replace('-pooler.', '.') !==
      new URL(ownerUrl).hostname.replace('-pooler.', '.') ||
    new URL(runtime).pathname !== new URL(ownerUrl).pathname
  )
    throw new Error(
      'Ledger verification must target the same independent ledger database',
    );
  const writer = new pg.Pool({ ...postgresOptions(runtime), max: 1 }),
    reader = new pg.Pool({ ...postgresOptions(ownerUrl), max: 1 });
  try {
    const store = databaseLedger(writer);
    await store.assertReady();
    let batch: LedgerEntry[] = [],
      copied = 0;
    async function flush() {
      if (!batch.length) return;
      await store.persist(batch);
      const { rows } = await reader.query<{
        subjectHash: string;
        expiresAt: Date;
      }>(
        'SELECT subject_hash AS "subjectHash",expires_at AS "expiresAt" FROM portl_erasure_ledger.tombstone WHERE subject_hash=ANY($1::text[])',
        [batch.map((row) => row.subjectHash)],
      );
      const verified = new Map(
        rows.map((row) => [row.subjectHash, row.expiresAt.getTime()]),
      );
      if (
        batch.some(
          (row) =>
            (verified.get(row.subjectHash) ?? 0) < Date.parse(row.expiresAt),
        )
      )
        throw new Error(
          'Ledger transfer verification failed; keep the old volume',
        );
      copied += batch.length;
      batch = [];
    }
    for await (const entry of readLedger(directory)) {
      if (Date.parse(entry.expiresAt) <= Date.now()) continue;
      batch.push(entry);
      if (batch.length === 100) await flush();
    }
    await flush();
    console.log(
      `Verified ${copied} unexpired erasure records in the independent ledger. Source files retained.`,
    );
  } finally {
    await writer.end();
    await reader.end();
  }
}
void main().catch(() => {
  console.error(
    'Erasure ledger operation failed; credentials withheld. Verify independent project access and the private output/source paths.',
  );
  process.exitCode = 1;
});
