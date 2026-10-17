import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createDatabase } from '../database/client.js';
import { accountProof } from './proof.js';
import { persistLedger, readLedger } from './ledger.js';
import { restoreAccountErasures } from './restore.js';
it('reapplies an externally recorded erasure to an older snapshot without deleting an unrelated account', async () => {
  if (!process.env.PORTL_TEST_DATABASE_URL)
    throw new Error('Isolated database required');
  const db = createDatabase(
    process.env.PORTL_TEST_DIRECT_DATABASE_URL ||
      process.env.DIRECT_DATABASE_URL!,
  );
  const path = await mkdtemp(join(tmpdir(), 'portl-restore-'));
  const erased = randomUUID(),
    unrelated = randomUUID(),
    proof = accountProof('restore-integration-only-constant-secret');
  try {
    await db.user.createMany({
      data: [erased, unrelated].map((id) => ({
        id,
        email: `${id}@restore-test.invalid`,
        name: 'Restore fixture',
        emailVerified: true,
      })),
    });
    await persistLedger(path, [
      {
        subjectHash: proof.subject(erased),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ]);
    expect(await restoreAccountErasures(db, readLedger(path))).toBe(1);
    expect(await db.user.findUnique({ where: { id: erased } })).toBeNull();
    expect(
      await db.user.findUnique({ where: { id: unrelated } }),
    ).not.toBeNull();
    expect(await restoreAccountErasures(db, readLedger(path))).toBe(0);
  } finally {
    await db.accountDeletion.deleteMany({
      where: { subjectHash: proof.subject(erased) },
    });
    await db.user.deleteMany({ where: { id: { in: [erased, unrelated] } } });
    await db.$disconnect();
    await rm(path, { recursive: true, force: true });
  }
}, 60000);
