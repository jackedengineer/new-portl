import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createDatabase } from '../database/client.js';
import { accountProof } from './proof.js';
import { readLedger, fileLedger } from './ledger.js';
import { accountWorker } from './worker.js';
import type { Logger } from 'pino';

it('runs metadata maintenance and completes erasure through the real restricted worker client', async () => {
  if (!process.env.PORTL_TEST_DATABASE_URL || !process.env.WORKER_DATABASE_URL)
    throw new Error('Isolated integration database and worker are required');
  const owner = createDatabase(
    process.env.PORTL_TEST_DIRECT_DATABASE_URL ||
      process.env.DIRECT_DATABASE_URL!,
  );
  const worker = createDatabase(process.env.WORKER_DATABASE_URL);
  const id = randomUUID(),
    proof = accountProof('worker-regression-only-secret'),
    subjectHash = proof.subject(id);
  const path = await mkdtemp(join(tmpdir(), 'portl-worker-integration-'));
  const logger = { error: vi.fn(), info: vi.fn() };
  let stop: (() => Promise<void>) | undefined;
  try {
    await owner.user.create({
      data: {
        id,
        email: `${id}@worker-test.invalid`,
        name: 'Disposable worker fixture',
        emailVerified: true,
        deletionRequestedAt: new Date(),
      },
    });
    await owner.accountDeletion.create({
      data: {
        id: randomUUID(),
        userId: id,
        subjectHash,
        receiptHash: proof.receipt(randomUUID()),
      },
    });
    stop = await accountWorker(
      worker,
      logger as unknown as Logger,
      fileLedger(path),
    );
    await stop();
    stop = undefined;
    expect(logger.error).not.toHaveBeenCalled();
    expect(await owner.user.findUnique({ where: { id } })).toBeNull();
    expect(
      await owner.accountDeletion.findFirst({ where: { subjectHash } }),
    ).toMatchObject({ status: 'COMPLETED' });
    const entries = [];
    for await (const entry of readLedger(path)) entries.push(entry);
    expect(entries.map((entry) => entry.subjectHash)).toContain(subjectHash);
  } finally {
    await stop?.();
    await owner.accountDeletion.deleteMany({ where: { subjectHash } });
    await owner.user.deleteMany({ where: { id } });
    await Promise.all([owner.$disconnect(), worker.$disconnect()]);
    await rm(path, { recursive: true, force: true });
  }
}, 60000);
