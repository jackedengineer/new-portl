import { randomUUID } from 'node:crypto';
import {
  open,
  readFile,
  rename,
  lstat,
  unlink,
  opendir,
} from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { z } from 'zod';
const entrySchema = z.strictObject({
  subjectHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
});
export type LedgerEntry = z.infer<typeof entrySchema>;
const filename = /^[a-f0-9]{64}\.json$/;
const stagingName = /^\.[a-f0-9-]{36}\.tmp$/;
const missing = (error: unknown) =>
  error &&
  typeof error === 'object' &&
  'code' in error &&
  error.code === 'ENOENT';
export async function assertLedgerDirectory(path: string) {
  if (!isAbsolute(path)) throw new Error('Ledger path must be absolute');
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error('Ledger must be a private directory');
}
async function readEntry(
  path: string,
  subjectHash: string,
): Promise<LedgerEntry> {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 1024 ||
    (info.mode & 0o077) !== 0
  )
    throw new Error('Ledger record must be a private regular file under 1KB');
  const entry = entrySchema.parse(JSON.parse(await readFile(path, 'utf8')));
  if (entry.subjectHash !== subjectHash)
    throw new Error('Ledger record identity mismatch');
  return entry;
}
// Stream records: the retention window has no fixed account-count ceiling.
export async function* readLedger(directory: string) {
  await assertLedgerDirectory(directory);
  for await (const file of await opendir(directory)) {
    if (stagingName.test(file.name)) continue;
    if (!filename.test(file.name))
      throw new Error('Unexpected file in deletion ledger');
    yield await readEntry(join(directory, file.name), file.name.slice(0, 64));
  }
}
// One worker owns this private directory. Run before its first tick and hourly;
// abandoned atomic-write staging files contain no committed deletion decision.
export async function cleanupLedger(directory: string) {
  await assertLedgerDirectory(directory);
  for await (const file of await opendir(directory)) {
    const path = join(directory, file.name);
    if (stagingName.test(file.name)) {
      await unlink(path);
      continue;
    }
    if (!filename.test(file.name))
      throw new Error('Unexpected file in deletion ledger');
    const entry = await readEntry(path, file.name.slice(0, 64));
    if (Date.parse(entry.expiresAt) <= Date.now()) await unlink(path);
  }
}
// Persist each subject before erasure. Preserve newer external tombstones when
// replaying an older database snapshot. Bounded input, independent durable files.
export async function persistLedger(directory: string, entries: LedgerEntry[]) {
  z.array(entrySchema).max(100).parse(entries);
  if (!isAbsolute(directory)) throw new Error('Ledger path must be absolute');
  await assertLedgerDirectory(directory);
  for (const entry of entries) {
    if (Date.parse(entry.expiresAt) <= Date.now()) continue;
    const path = join(directory, `${entry.subjectHash}.json`);
    let output = entry;
    try {
      const previous = await readEntry(path, entry.subjectHash);
      if (Date.parse(previous.expiresAt) > Date.parse(output.expiresAt))
        output = previous;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const staging = join(directory, `.${randomUUID()}.tmp`);
    try {
      const handle = await open(staging, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(output) + '\n');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(staging, path);
      const dir = await open(directory, 'r');
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } finally {
      await unlink(staging).catch((error: unknown) => {
        if (!missing(error)) throw error;
      });
    }
  }
}
