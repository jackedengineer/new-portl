import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { evaluateAudit, policy, verifyFiles } from './audit-policy.mts';

const now = new Date('2026-10-11T00:00:00Z');
function report() {
  return {
    muted: [],
    advisories: Object.fromEntries(
      policy.patches.map((p) => [
        p.ghsa,
        {
          github_advisory_id: p.ghsa,
          module_name: p.name,
          severity: 'high',
          patched_versions: '<0.0.0',
          findings: [{ version: p.version }],
        },
      ]),
    ),
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0 },
    },
  };
}
test('accepts only the two reviewed advisory identities and reports them', () => {
  assert.equal(
    evaluateAudit(report(), now).filter((s) =>
      s.includes('verified local patch'),
    ).length,
    2,
  );
});
test('fails when exceptions expire, including the exact boundary', () => {
  assert.throws(
    () => evaluateAudit(report(), new Date(policy.expiresAt)),
    /expired/,
  );
});
test('rejects a new high or critical advisory', () => {
  for (const severity of ['high', 'critical']) {
    const input = report();
    input.advisories['GHSA-aaaa-bbbb-cccc'] = {
      ...Object.values(input.advisories)[0]!,
      github_advisory_id: 'GHSA-aaaa-bbbb-cccc',
      severity,
    };
    assert.throws(() => evaluateAudit(input, now), /Unmitigated/);
  }
});
test('rejects changed severity, package or affected version', () => {
  for (const change of [
    { severity: 'critical' },
    { module_name: 'other' },
    { findings: [{ version: '1.0.0' }] },
  ]) {
    const input = report();
    Object.assign(Object.values(input.advisories)[0]!, change);
    assert.throws(() => evaluateAudit(input, now));
  }
});
test('requires replacing backports when an upstream fix becomes available', () => {
  const input = report();
  Object.values(input.advisories)[0]!.patched_versions = '>=1.4.1';
  assert.throws(() => evaluateAudit(input, now), /upstream fix available/);
});
test('rejects stale exceptions and incomplete audit metadata', () => {
  const input = report();
  delete input.advisories[policy.patches[0]!.ghsa];
  assert.throws(() => evaluateAudit(input, now), /Incomplete/);
  input.metadata.vulnerabilities.high = 1;
  assert.throws(() => evaluateAudit(input, now), /stale exception/);
});
test('fails closed on registry errors, muted advisories and malformed reports', () => {
  for (const input of [
    null,
    { error: 'registry unavailable' },
    { ...report(), muted: ['GHSA-aaaa-bbbb-cccc'] },
    { ...report(), metadata: {} },
  ]) {
    assert.throws(() => evaluateAudit(input, now));
  }
});
test('rejects missing or changed installed patch bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'portl-patch-check-'));
  try {
    const files = {
      'source.js': createHash('sha256').update('patched source').digest('hex'),
    };
    assert.throws(() => verifyFiles(directory, files));
    writeFileSync(join(directory, 'source.js'), 'patched source');
    verifyFiles(directory, files);
    writeFileSync(join(directory, 'source.js'), 'original source');
    assert.throws(
      () => verifyFiles(directory, files),
      /Security patch mismatch/,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});
