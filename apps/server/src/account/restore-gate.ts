import type pg from 'pg';

/** Owner-only restore tooling; an unresolved migration must fail closed. */
export async function assertLedgerRestoreAllowed(
  client: Pick<pg.Pool, 'query'>,
) {
  const { rows } = await client.query<{ blocked: boolean }>(
    'SELECT blocked FROM portl_erasure_ledger.restore_gate WHERE singleton',
  );
  if (rows.length !== 1 || rows[0]?.blocked !== false)
    throw new Error(
      'Offline restore blocked until deletion-ledger reconciliation',
    );
}
