import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { reviewerRole } from '@portl/contracts';
import { createDatabase } from '../src/database/client.js';
import {
  createReviewRealm,
  rotateReviewKey,
  setReviewRealmEnabled,
} from '../src/reviewer/operator.js';

async function privateOutput(raw: string) {
  const path = join(
    await realpath(dirname(resolve(raw))),
    resolve(raw).split('/').at(-1)!,
  );
  for (let parent = dirname(path); ;) {
    if (
      await lstat(join(parent, '.git')).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        },
      )
    )
      throw new Error('Save credentials outside Git');
    const next = dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  return open(path, 'wx', 0o600);
}
async function main() {
  const [action, argument, output] = process.argv.slice(2);
  if (!process.env.DIRECT_DATABASE_URL || !process.env.BETTER_AUTH_SECRET)
    throw new Error('Owner connection and auth secret required');
  if (!['create', 'rotate', 'enable', 'disable'].includes(action || ''))
    throw new Error(
      'Use create <private-output.json>, rotate <ROLE> <private-output.json>, enable or disable',
    );
  const role = action === 'rotate' ? reviewerRole.parse(argument) : null;
  const file =
    action === 'create' || action === 'rotate'
      ? await privateOutput((action === 'create' ? argument : output) || '')
      : null;
  const db = createDatabase(process.env.DIRECT_DATABASE_URL);
  try {
    if (action === 'create') {
      const data = await createReviewRealm(db, process.env.BETTER_AUTH_SECRET);
      await file!.writeFile(JSON.stringify(data, null, 2));
      await file!.sync();
      await setReviewRealmEnabled(db, true);
    } else if (action === 'rotate') {
      // If disk writing fails, the previous key is already revoked. Run rotation
      // again into a new file; no stale credential regains access.
      const data = await rotateReviewKey(
        db,
        process.env.BETTER_AUTH_SECRET,
        role!,
      );
      await file!.writeFile(JSON.stringify(data, null, 2));
      await file!.sync();
    } else await setReviewRealmEnabled(db, action === 'enable');
    console.log(
      'Review operation completed. Credentials are only in the private output file, if requested.',
    );
  } finally {
    await file?.close();
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'Review operation failed. Check owner access, command and private output path. No credentials printed. Creation stays disabled until its key file is saved; failed rotation may require another rotation.',
  );
  process.exitCode = 1;
});
