import { randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { accountProof } from './proof.js';
import type { LedgerEntry } from './ledger.js';
// Owner-only offline operation. Never mount this as an HTTP endpoint.
export async function restoreAccountErasures(
  db: PrismaClient,
  source: AsyncIterable<LedgerEntry>,
) {
  const proof = accountProof('restore-does-not-use-otp-or-email-hmac');
  let queued = 0;
  for await (const entry of source) {
    if (Date.parse(entry.expiresAt) <= Date.now()) continue;
    queued += await db.$transaction(async (tx) => {
      const users = await tx.$queryRaw<
        { id: string; email: string }[]
      >`SELECT id,email FROM portl_auth."User" WHERE encode(sha256(convert_to('portl-erased-user:'||id,'UTF8')),'hex')=${entry.subjectHash} FOR UPDATE`;
      if (!users.length) return 0;
      const user = users[0]!;
      await tx.user.update({
        where: { id: user.id },
        data: { deletionRequestedAt: new Date() },
      });
      await tx.accountDeletion.upsert({
        where: { userId: user.id },
        create: {
          id: randomUUID(),
          userId: user.id,
          subjectHash: entry.subjectHash,
          emailHash: proof.email(user.email),
          receiptHash: proof.receipt(randomBytes(32).toString('hex')),
        },
        update: {
          status: 'PENDING',
          completedAt: null,
          nextAttemptAt: new Date(),
        },
      });
      await tx.$executeRaw`SELECT portl_auth.revoke_account_devices(${user.id})`;
      await tx.session.deleteMany({ where: { userId: user.id } });
      return 1;
    });
    // Process this persisted subject synchronously before reading another record.
    const [row] = await db.$queryRaw<
      { status: string }[]
    >`SELECT portl_auth.process_account_deletion(${[entry.subjectHash]}::text[]) AS status`;
    if (row?.status === 'RETRY')
      throw new Error(
        'Restore erasure failed; keep the deployment offline and investigate',
      );
  }
  const pending = await db.accountDeletion.count({
    where: { status: 'PENDING' },
  });
  if (pending)
    throw new Error(
      'Pending deletion work remains; do not reopen the restored deployment',
    );
  return queued;
}
