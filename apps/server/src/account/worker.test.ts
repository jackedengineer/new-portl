import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { PrismaClient } from '../generated/prisma/client.js';
import { accountWorker } from './worker.js';
import { readLedger } from './ledger.js';
it.each([false, true])(
  'allows erasure only after durable ledger persistence (disk unavailable: %s)',
  async (unavailable) => {
    const path = await mkdtemp(join(tmpdir(), 'portl-worker-'));
    const subjectHash = 'a'.repeat(64),
      expiresAt = new Date(Date.now() + 86400000);
    let processed = false;
    const logger = { error: vi.fn(), info: vi.fn() };
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join('');
      if (sql.includes('has_function_privilege'))
        return [{ process: true, cleanup: true }];
      if (sql.includes('account_deletion_ledger'))
        return [{ subjectHash, expiresAt }];
      if (sql.includes('process_account_deletion')) {
        const entries = [];
        for await (const entry of readLedger(path)) entries.push(entry);
        expect(entries).toEqual([
          { subjectHash, expiresAt: expiresAt.toISOString() },
        ]);
        processed = true;
        return [{ status: 'COMPLETED' }];
      }
      return [];
    });
    const execute = vi.fn().mockResolvedValue(1);
    try {
      if (unavailable) await chmod(path, 0o755);
      const stop = await accountWorker(
        { $queryRaw: query, $executeRaw: execute } as unknown as PrismaClient,
        logger as unknown as Logger,
        path,
      );
      await stop();
      expect(processed).toBe(!unavailable);
      expect(execute).toHaveBeenCalledTimes(unavailable ? 0 : 1);
      expect(logger.error).toHaveBeenCalledTimes(unavailable ? 1 : 0);
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  },
);
