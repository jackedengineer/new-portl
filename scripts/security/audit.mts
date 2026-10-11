import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { evaluateAudit, verifyInstalledPatches } from './audit-policy.mts';
import { pnpm, root } from './installed.mts';

verifyInstalledPatches();
const tests = spawnSync(
  process.execPath,
  [
    '--test',
    'scripts/security/patches.test.mts',
    'scripts/security/audit-policy.test.mts',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    timeout: 120_000,
  },
);
assert.ifError(tests.error);
assert.equal(tests.status, 0, 'Security regression tests failed');
const audit = pnpm(['audit', '--json']);
assert(
  audit.status === 0 || audit.status === 1,
  'Registry audit failed to run',
);
const decisions = evaluateAudit(JSON.parse(audit.stdout));
console.log(decisions.join('\n'));
console.log(
  'Dependency gate passed with two verified temporary backports. Raw pnpm audit still reports original versions.',
);
