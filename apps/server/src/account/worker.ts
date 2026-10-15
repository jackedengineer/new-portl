import { persistLedger, cleanupLedger } from './ledger.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Logger } from 'pino';
export async function accountWorker(
  db: PrismaClient,
  logger: Logger,
  ledgerPath: string,
) {
  const [grants] = await db.$queryRaw<
    { process: boolean; cleanup: boolean; lifecycle: boolean }[]
  >`SELECT has_function_privilege(current_user,'portl_auth.process_account_deletion(text[])','EXECUTE') AS process, has_function_privilege(current_user,'portl_auth.cleanup_account_metadata()','EXECUTE') AS cleanup, has_function_privilege(current_user,'portl_auth.cleanup_review_lifecycle()','EXECUTE') AS lifecycle`;
  if (!grants?.process || !grants.cleanup || !grants.lifecycle)
    throw new Error('Account worker grants missing');
  let stopped = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    running: Promise<void> = Promise.resolve(),
    lastCleanup = 0;
  const tick = async () => {
    try {
      const ledger = await db.$queryRaw<
        { subjectHash: string; expiresAt: Date }[]
      >`SELECT * FROM portl_auth.account_deletion_ledger()`;
      await persistLedger(
        ledgerPath,
        ledger.map((row) => ({
          subjectHash: row.subjectHash,
          expiresAt: row.expiresAt.toISOString(),
        })),
      );
      await db.$executeRaw`SELECT portl_auth.cleanup_review_lifecycle()`;
      if (Date.now() - lastCleanup >= 3600000) {
        await cleanupLedger(ledgerPath);
        await db.$executeRaw`SELECT portl_auth.cleanup_account_metadata()`;
        lastCleanup = Date.now();
      }
      const [row] = await db.$queryRaw<
        { status: string }[]
      >`SELECT portl_auth.process_account_deletion(${ledger.map((row) => row.subjectHash)}::text[]) AS status`;
      if (row?.status === 'RETRY')
        logger.error(
          'Account deletion cleanup failed and is scheduled for retry',
        );
      if (row?.status === 'COMPLETED')
        logger.info('Account deletion cleanup completed');
    } catch {
      logger.error(
        'Account lifecycle worker unavailable; pending requests remain queued',
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          running = tick();
        }, 3000);
        timer.unref();
      }
    }
  };
  running = tick();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await running;
  };
}
