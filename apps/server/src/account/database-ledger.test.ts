import { expect, it, vi } from 'vitest';
import { databaseLedger, independentLedgerUrl } from './database-ledger.js';

const entry = {
  subjectHash: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
};
it('rejects an erasure ledger on the business database endpoint, including pooled aliases', () => {
  expect(() =>
    independentLedgerUrl(
      'postgresql://worker:secret@ep-example-pooler.ap-southeast-1.aws.neon.tech/ledger',
      'postgresql://api:secret@ep-example.ap-southeast-1.aws.neon.tech/neondb',
    ),
  ).toThrow('independent');
});
it('persists the complete batch before accepting acknowledgement', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ persisted: 1 }] });
  const ledger = databaseLedger({ query });
  await ledger.persist([entry]);
  expect(query.mock.calls[0]?.[1]).toEqual([JSON.stringify([entry])]);
  query.mockResolvedValue({ rows: [{ persisted: 0 }] });
  await expect(ledger.persist([entry])).rejects.toThrow('incomplete');
});
it('does not wake the external database for empty batches and rejects malformed or unbounded input', async () => {
  const query = vi.fn();
  const ledger = databaseLedger({ query });
  await ledger.persist([]);
  await expect(
    ledger.persist([{ ...entry, subjectHash: 'invalid' }]),
  ).rejects.toThrow();
  await expect(ledger.persist(Array(101).fill(entry))).rejects.toThrow();
  expect(query).not.toHaveBeenCalled();
});
it('rejects ledger credentials with direct table access or missing restricted RPCs', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ safe: false }] });
  await expect(databaseLedger({ query }).assertReady()).rejects.toThrow(
    'restricted',
  );
  query.mockResolvedValue({ rows: [{ safe: true }] });
  await expect(
    databaseLedger({ query }).assertReady(),
  ).resolves.toBeUndefined();
});
