import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const packageNames = ['node-forge', 'braces'] as const;
export type PackageName = (typeof packageNames)[number];
export type InstalledPackage = {
  name: PackageName;
  version: string;
  path: string;
};

export function pnpm(args: string[]) {
  const result = spawnSync('pnpm', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, 'pnpm was terminated');
  return result;
}

// Inspect the active dependency graph, not stale directories in pnpm's store.
export function installedPackages(): InstalledPackage[] {
  const result = pnpm([
    'list',
    '--recursive',
    ...packageNames,
    '--depth',
    'Infinity',
    '--json',
  ]);
  assert.equal(result.status, 0, 'Cannot inspect installed dependency graph');
  const packages = new Map<string, InstalledPackage>();
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const [name, child] of Object.entries(value)) {
      if (packageNames.includes(name as PackageName)) {
        assert(child && typeof child === 'object');
        assert('path' in child && typeof child.path === 'string');
        assert('version' in child && typeof child.version === 'string');
        packages.set(child.path, {
          name: name as PackageName,
          path: child.path,
          version: child.version,
        });
      }
      visit(child);
    }
  }
  visit(JSON.parse(result.stdout));
  for (const name of packageNames) {
    assert(
      [...packages.values()].some((pkg) => pkg.name === name),
      `Missing ${name}`,
    );
  }
  return [...packages.values()];
}
