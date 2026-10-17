import type pg from 'pg';
import {
  ledgerEntriesSchema,
  type DeletionLedger,
  type LedgerEntry,
} from './ledger.js';

/** Endpoint independence is checked here and project independence during provisioning. */
export function independentLedgerUrl(ledger: string, business: string) {
  if (!URL.canParse(ledger) || !URL.canParse(business))
    throw new Error(
      'Invalid erasure ledger database configuration; secrets withheld',
    );
  const external = new URL(ledger),
    primary = new URL(business);
  if (
    !['postgres:', 'postgresql:'].includes(external.protocol) ||
    external.hostname.replace('-pooler.', '.') ===
      primary.hostname.replace('-pooler.', '.')
  )
    throw new Error('Erasure ledger must use an independent database project');
  return ledger;
}
type Connection = Pick<pg.Pool, 'query'>;
export function databaseLedger(client: Connection): DeletionLedger {
  return {
    async assertReady() {
      const { rows } = await client.query<{ safe: boolean }>(`
        SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole)
          AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
          AND has_function_privilege(current_user,'portl_erasure_ledger.persist(jsonb)','EXECUTE')
          AND has_function_privilege(current_user,'portl_erasure_ledger.cleanup()','EXECUTE')
          AND NOT has_table_privilege(current_user,'portl_erasure_ledger.tombstone','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS safe
        FROM pg_roles r WHERE r.rolname=current_user
      `);
      if (!rows[0]?.safe)
        throw new Error('Erasure ledger requires restricted credentials');
    },
    async persist(entries) {
      ledgerEntriesSchema.parse(entries);
      const active = entries.filter(
        (entry) => Date.parse(entry.expiresAt) > Date.now(),
      );
      if (!active.length) return;
      const { rows } = await client.query<{ persisted: number }>(
        'SELECT portl_erasure_ledger.persist($1::jsonb) AS persisted',
        [JSON.stringify(active)],
      );
      if (rows[0]?.persisted !== active.length)
        throw new Error('Erasure ledger persistence incomplete');
    },
    async cleanup() {
      await client.query('SELECT portl_erasure_ledger.cleanup()');
    },
  };
}
/** Owner-only offline streaming; restricted worker credentials cannot read this table. */
export async function* readDatabaseLedger(
  client: Connection,
): AsyncGenerator<LedgerEntry> {
  let after = '';
  for (;;) {
    const { rows } = await client.query<{
      subjectHash: string;
      expiresAt: Date;
    }>(
      'SELECT subject_hash AS "subjectHash",expires_at AS "expiresAt" FROM portl_erasure_ledger.tombstone WHERE subject_hash>$1 AND expires_at>clock_timestamp() ORDER BY subject_hash LIMIT 100',
      [after],
    );
    if (!rows.length) return;
    const entries = ledgerEntriesSchema.parse(
      rows.map((row) => ({ ...row, expiresAt: row.expiresAt.toISOString() })),
    );
    yield* entries;
    after = entries.at(-1)!.subjectHash;
  }
}
