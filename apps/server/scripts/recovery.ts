import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createDatabase } from '../src/database/client.js';
import {
  cancelRecovery,
  prepareRecovery,
  recoveryStatus,
} from '../src/recovery/operator.js';
import { resendDelivery } from '../src/auth/email.js';
async function main() {
  const [action, argument] = process.argv.slice(2);
  if (!argument || !['prepare', 'status', 'cancel'].includes(action || ''))
    throw new Error(
      'Use db:recovery prepare <private-config.json>, status <case-id> or cancel <case-id>',
    );
  if (!process.env.DIRECT_DATABASE_URL || !process.env.BETTER_AUTH_SECRET)
    throw new Error(
      'Configure the operator-only database connection and auth secret',
    );
  const db = createDatabase(process.env.DIRECT_DATABASE_URL);
  try {
    if (action === 'prepare') {
      const path = resolve(argument),
        info = await lstat(path);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        (info.mode & 0o077) !== 0 ||
        info.size > 8192
      )
        throw new Error('Input must be a mode-0600 regular file under 8KB');
      if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
        throw new Error(
          'Email delivery configuration is required for preparation',
        );
      const result = await prepareRecovery(
        db,
        process.env.BETTER_AUTH_SECRET,
        JSON.parse(await readFile(path, 'utf8')),
        resendDelivery(process.env.RESEND_API_KEY, process.env.EMAIL_FROM),
      );
      console.log(
        JSON.stringify({
          id: result.id,
          status: 'PENDING',
          expiresAt: result.expiresAt,
        }),
      );
      console.log(
        'Recipient must sign in and complete Admin recovery in Account & privacy. No role or authenticator has changed.',
      );
    } else {
      const id = z.uuid().parse(argument);
      const result =
        action === 'cancel'
          ? await cancelRecovery(db, id)
          : await recoveryStatus(db, id);
      console.log(JSON.stringify(result));
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'Recovery command failed. Check owner access, private input, documented verification, target eligibility, timing and email delivery. No credentials printed; no recovery grant is implied.',
  );
  process.exitCode = 1;
});
