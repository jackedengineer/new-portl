import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { createOTP } from '@better-auth/utils/otp';
import { z } from 'zod';
import { createDatabase } from '../src/database/client.js';
import {
  bootstrapInput,
  bootstrapSocieties,
} from '../src/registry/bootstrap.js';

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Demo bootstrap is development-only');
  const [action, file] = process.argv.slice(2);
  if (!file || !['prepare', 'confirm'].includes(action || ''))
    throw new Error(
      'Use db:bootstrap prepare <private-config.json> or confirm <pending-file.json>',
    );
  const inputPath = resolve(file);
  const info = await stat(inputPath);
  if ((info.mode & 0o077) !== 0)
    throw new Error('Private input must have mode 0600');
  const source: unknown = JSON.parse(await readFile(inputPath, 'utf8'));
  if (action === 'prepare') {
    const config = bootstrapInput.parse(source);
    const totpSecret = randomBytes(32).toString('hex');
    const output = resolve('.local/bootstrap.pending.json');
    await mkdir(resolve('.local'), { recursive: true, mode: 0o700 });
    await writeFile(
      output,
      JSON.stringify(
        {
          config,
          totpSecret,
          totpURI: createOTP(totpSecret).url('Portl', config.adminEmail),
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    console.log(
      `Private authenticator setup written to ${output}. Import its totpURI into your authenticator, then run confirm. No database records created.`,
    );
    return;
  }
  const pending = z
    .object({
      config: bootstrapInput,
      totpSecret: z.string().min(32),
      totpURI: z.string(),
    })
    .parse(source);
  if (!process.env.DIRECT_DATABASE_URL || !process.env.BETTER_AUTH_SECRET)
    throw new Error('Migration connection and auth secret required');
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let confirmation: string;
  try {
    confirmation = await prompt.question(
      'Current code from the configured authenticator: ',
    );
  } finally {
    prompt.close();
  }
  const db = createDatabase(process.env.DIRECT_DATABASE_URL);
  try {
    const result = await bootstrapSocieties(
      db,
      process.env.BETTER_AUTH_SECRET,
      pending.config,
      pending.totpSecret,
      confirmation,
    );
    await unlink(inputPath);
    console.log(
      `Created ${result.societyCount} synthetic societies and their initial admin. Setup secret file removed. Email OTP login is still required.`,
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'Bootstrap failed. Check the private config, authenticator code and migration credentials. Existing authenticators are never replaced. No secrets printed.',
  );
  process.exitCode = 1;
});
