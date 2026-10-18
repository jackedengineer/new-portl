import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { expect, it } from 'vitest';
import { postgresOptions } from '../database/connection.js';
import { databaseLedger, readDatabaseLedger } from './database-ledger.js';
import { assertLedgerRestoreAllowed } from './restore-gate.js';

it('enforces restricted durable writes, monotonic expiry, atomic batches and owner-only streaming', async () => {
  if (process.env.NODE_ENV !== 'test' || !process.env.PORTL_TEST_DATABASE_URL)
    throw new Error('Isolated integration environment required');
  const url =
    process.env.PORTL_TEST_DIRECT_DATABASE_URL ||
    process.env.DIRECT_DATABASE_URL!;
  const owner = new pg.Client(postgresOptions(url));
  const role = `ledger_test_${randomBytes(8).toString('hex')}`,
    password = randomBytes(32).toString('base64url');
  const hashes = Array.from({ length: 4 }, () =>
    randomBytes(32).toString('hex'),
  );
  let worker: pg.Pool | undefined;
  await owner.connect();
  try {
    await owner.query('DROP TABLE IF EXISTS portl_erasure_ledger.restore_gate');
    await owner.query(
      await readFile(
        new URL('../../sql/erasure-ledger.sql', import.meta.url),
        'utf8',
      ),
    );
    await owner.query(
      `CREATE ROLE ${pg.escapeIdentifier(role)} LOGIN PASSWORD ${pg.escapeLiteral(password)} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`,
    );
    await owner.query(
      `GRANT USAGE ON SCHEMA portl_erasure_ledger TO ${pg.escapeIdentifier(role)}`,
    );
    await owner.query(
      `GRANT EXECUTE ON FUNCTION portl_erasure_ledger.persist(jsonb),portl_erasure_ledger.cleanup() TO ${pg.escapeIdentifier(role)}`,
    );
    const runtime = new URL(url);
    runtime.username = role;
    runtime.password = password;
    worker = new pg.Pool({ ...postgresOptions(runtime.toString()), max: 1 });
    const store = databaseLedger(worker);
    await store.assertReady();
    await expect(assertLedgerRestoreAllowed(owner)).rejects.toThrow(
      'reconciliation',
    );
    await owner.query('DELETE FROM portl_erasure_ledger.restore_gate');
    await expect(assertLedgerRestoreAllowed(owner)).rejects.toThrow(
      'reconciliation',
    );
    await expect(
      worker.query(
        'UPDATE portl_erasure_ledger.restore_gate SET blocked=false',
      ),
    ).rejects.toThrow();
    await expect(assertLedgerRestoreAllowed(worker)).rejects.toThrow();
    await owner.query(
      await readFile(
        new URL('../../sql/erasure-ledger.sql', import.meta.url),
        'utf8',
      ),
    );
    await expect(assertLedgerRestoreAllowed(owner)).rejects.toThrow(
      'reconciliation',
    );
    await owner.query(
      await readFile(
        new URL('../../sql/erasure-ledger.sql', import.meta.url),
        'utf8',
      ),
    );
    await expect(assertLedgerRestoreAllowed(owner)).rejects.toThrow(
      'reconciliation',
    );
    const expiry = new Date(Date.now() + 2 * 86400000).toISOString();
    await store.persist([{ subjectHash: hashes[0]!, expiresAt: expiry }]);
    await store.persist([
      {
        subjectHash: hashes[0]!,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ]);
    const { rows } = await owner.query(
      'SELECT expires_at FROM portl_erasure_ledger.tombstone WHERE subject_hash=$1',
      [hashes[0]],
    );
    expect(rows[0]?.expires_at.toISOString()).toBe(expiry);
    await expect(
      worker.query('SELECT * FROM portl_erasure_ledger.tombstone'),
    ).rejects.toThrow();
    await expect(
      worker.query('DELETE FROM portl_erasure_ledger.tombstone'),
    ).rejects.toThrow();
    await expect(
      worker.query('SELECT portl_erasure_ledger.persist($1::jsonb)', [
        JSON.stringify([
          { subjectHash: hashes[1], expiresAt: expiry },
          { subjectHash: 'invalid', expiresAt: expiry },
        ]),
      ]),
    ).rejects.toThrow();
    expect(
      (
        await owner.query(
          'SELECT count(*)::int AS count FROM portl_erasure_ledger.tombstone WHERE subject_hash=$1',
          [hashes[1]],
        )
      ).rows[0]?.count,
    ).toBe(0);
    await owner.query(
      "INSERT INTO portl_erasure_ledger.tombstone VALUES ($1,clock_timestamp()-interval '1 second')",
      [hashes[2]],
    );
    await store.cleanup();
    expect(
      (
        await owner.query(
          'SELECT subject_hash FROM portl_erasure_ledger.tombstone WHERE subject_hash=ANY($1::text[])',
          [hashes],
        )
      ).rows.map((row) => row.subject_hash),
    ).toEqual([hashes[0]]);
    await expect(assertLedgerRestoreAllowed(owner)).rejects.toThrow(
      'reconciliation',
    );
    const streamed = [];
    for await (const entry of readDatabaseLedger(owner))
      if (hashes.includes(entry.subjectHash)) streamed.push(entry);
    expect(streamed).toEqual([{ subjectHash: hashes[0], expiresAt: expiry }]);
    await owner.query(
      'UPDATE portl_erasure_ledger.restore_gate SET blocked=false WHERE singleton',
    );
    await assertLedgerRestoreAllowed(owner);
    await owner.query(
      `GRANT SELECT ON portl_erasure_ledger.tombstone TO ${pg.escapeIdentifier(role)}`,
    );
    await expect(store.assertReady()).rejects.toThrow('restricted');
  } finally {
    await worker?.end();
    await owner.query(
      'DELETE FROM portl_erasure_ledger.tombstone WHERE subject_hash=ANY($1::text[])',
      [hashes],
    );
    await owner.query(
      `REVOKE ALL ON portl_erasure_ledger.tombstone FROM ${pg.escapeIdentifier(role)}`,
    );
    await owner.query(
      `REVOKE ALL ON FUNCTION portl_erasure_ledger.persist(jsonb),portl_erasure_ledger.cleanup() FROM ${pg.escapeIdentifier(role)}`,
    );
    await owner.query(
      `REVOKE ALL ON SCHEMA portl_erasure_ledger FROM ${pg.escapeIdentifier(role)}`,
    );
    await owner.query(`DROP ROLE ${pg.escapeIdentifier(role)}`);
    await owner.end();
  }
}, 60000);
