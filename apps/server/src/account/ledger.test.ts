import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { persistLedger, readLedger, cleanupLedger } from './ledger.js';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
const paths: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockImplementation(
    (await vi.importActual<typeof fs>('node:fs/promises')).open,
  );
  for (const path of paths.splice(0))
    await fs.rm(path, { recursive: true, force: true });
});
async function directory() {
  const path = await fs.mkdtemp(join(tmpdir(), 'portl-ledger-'));
  paths.push(path);
  return path;
}
async function records(path: string) {
  const entries = [];
  for await (const entry of readLedger(path)) entries.push(entry);
  return entries.sort((a, b) => a.subjectHash.localeCompare(b.subjectHash));
}
it('preserves newer external erasures across an older database restore and prunes only elapsed records', async () => {
  const path = await directory();
  const later = new Date(Date.now() + 900000).toISOString(),
    earlier = new Date(Date.now() + 100000).toISOString();
  await persistLedger(path, [
    { subjectHash: 'a'.repeat(64), expiresAt: later },
  ]);
  await persistLedger(path, [
    { subjectHash: 'a'.repeat(64), expiresAt: earlier },
    { subjectHash: 'b'.repeat(64), expiresAt: earlier },
  ]);
  await fs.writeFile(
    join(path, `${'c'.repeat(64)}.json`),
    JSON.stringify({
      subjectHash: 'c'.repeat(64),
      expiresAt: new Date(0).toISOString(),
    }),
    { mode: 0o600 },
  );
  await fs.writeFile(join(path, `.${randomUUID()}.tmp`), 'incomplete', {
    mode: 0o600,
  });
  await cleanupLedger(path);
  expect(await records(path)).toEqual([
    { subjectHash: 'a'.repeat(64), expiresAt: later },
    { subjectHash: 'b'.repeat(64), expiresAt: earlier },
  ]);
  expect((await fs.readdir(path)).length).toBe(2);
});
it('fails closed on corrupt or publicly readable records and directories', async () => {
  const path = await directory(),
    name = join(path, `${'a'.repeat(64)}.json`);
  const entry = {
    subjectHash: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  };
  await fs.writeFile(name, 'broken', { mode: 0o600 });
  await expect(persistLedger(path, [entry])).rejects.toThrow();
  await fs.writeFile(name, JSON.stringify(entry));
  await fs.chmod(name, 0o644);
  await expect(persistLedger(path, [entry])).rejects.toThrow('private');
  await fs.chmod(path, 0o755);
  await expect(persistLedger(path, [])).rejects.toThrow('private');
});
it('cleans a staging file even when writing its contents fails', async () => {
  const path = await directory(),
    originalOpen = (await vi.importActual<typeof fs>('node:fs/promises')).open;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith('.tmp'))
      vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(
        new Error('simulated disk failure'),
      );
    return handle;
  });
  await expect(
    persistLedger(path, [
      {
        subjectHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 900000).toISOString(),
      },
    ]),
  ).rejects.toThrow('disk failure');
  expect(await fs.readdir(path)).toEqual([]);
});
it('accepts additional bounded batches after more than 5000 retained subjects', async () => {
  const path = await directory(),
    expiresAt = new Date(Date.now() + 900000).toISOString();
  // Prepopulate retained history, then exercise a real atomic append and streaming read.
  for (let start = 0; start < 5001; start += 100)
    await Promise.all(
      Array.from({ length: Math.min(100, 5001 - start) }, (_, i) => {
        const subjectHash = (start + i).toString(16).padStart(64, '0');
        return fs.writeFile(
          join(path, `${subjectHash}.json`),
          JSON.stringify({ subjectHash, expiresAt }),
          { mode: 0o600 },
        );
      }),
    );
  await persistLedger(path, [{ subjectHash: 'f'.repeat(64), expiresAt }]);
  expect((await records(path)).length).toBe(5002);
}, 15000);

it('does not recreate a lost ledger directory after initialization', async () => {
  const path = await directory();
  await persistLedger(path, []);
  await fs.rm(path, { recursive: true });
  await expect(persistLedger(path, [])).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await expect(fs.lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
});
