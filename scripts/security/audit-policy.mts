import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import policy from './patch-policy.json' with { type: 'json' };
import { installedPackages, root } from './installed.mts';

export { policy };
const severities = ['info', 'low', 'moderate', 'high', 'critical'] as const;
type Severity = (typeof severities)[number];
function record(value: unknown): Record<string, unknown> {
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    'Invalid audit object',
  );
  return value as Record<string, unknown>;
}

export function verifyFiles(base: string, files: Record<string, string>) {
  for (const [file, expected] of Object.entries(files)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(base, file)))
      .digest('hex');
    assert.equal(actual, expected, `Security patch mismatch: ${file}`);
  }
}

export function verifyInstalledPatches() {
  const installed = installedPackages();
  for (const patch of policy.patches) {
    verifyFiles(root, { [patch.patch]: patch.sha256 });
    const copies = installed.filter((pkg) => pkg.name === patch.name);
    assert(copies.length > 0, `Missing patched package: ${patch.name}`);
    for (const pkg of copies) {
      assert.equal(
        pkg.version,
        patch.version,
        `Unreviewed ${pkg.name} version`,
      );
      verifyFiles(pkg.path, patch.files);
    }
  }
}

// Registry versions still match advisories after local patching. Accept only the
// two verified backports; never suppress advisory collection or registry errors.
export function evaluateAudit(input: unknown, now = new Date()): string[] {
  assert(
    now.getTime() < Date.parse(policy.expiresAt),
    'Security patch exceptions expired; review upstream fixes',
  );
  const report = record(input);
  assert(
    Array.isArray(report.muted) && report.muted.length === 0,
    'Audit contains muted advisories',
  );
  const advisories = Object.values(record(report.advisories));
  const counts = record(record(report.metadata).vulnerabilities);
  const seen = new Set<string>();
  const observed = Object.fromEntries(severities.map((s) => [s, 0])) as Record<
    Severity,
    number
  >;
  const decisions: string[] = [];
  for (const value of advisories) {
    const advisory = record(value);
    assert(
      typeof advisory.github_advisory_id === 'string' &&
        /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(
          advisory.github_advisory_id,
        ),
      'Missing advisory identity',
    );
    const id = advisory.github_advisory_id;
    assert(!seen.has(id), 'Duplicate advisory identity');
    seen.add(id);
    assert(
      severities.includes(advisory.severity as Severity),
      'Unknown audit severity',
    );
    const severity = advisory.severity as Severity;
    observed[severity]++;
    assert(typeof advisory.module_name === 'string', 'Missing package name');
    const patch = policy.patches.find((p) => p.ghsa === id);
    if (patch) {
      assert.equal(
        severity,
        'high',
        `${id}: severity changed; review required`,
      );
      assert.equal(advisory.module_name, patch.name, `${id}: package changed`);
      assert.equal(
        advisory.patched_versions,
        '<0.0.0',
        `${id}: upstream fix available; replace local patch`,
      );
      assert(
        Array.isArray(advisory.findings) && advisory.findings.length > 0,
        'Missing affected versions',
      );
      for (const finding of advisory.findings) {
        assert.equal(
          record(finding).version,
          patch.version,
          `${id}: unreviewed affected version`,
        );
      }
      decisions.push(
        `HIGH ${id} ${patch.name}: verified local patch; exception expires ${policy.expiresAt}`,
      );
    } else {
      assert(
        severity !== 'high' && severity !== 'critical',
        `Unmitigated ${severity} advisory: ${id} (${advisory.module_name})`,
      );
      decisions.push(
        `${severity.toUpperCase()} ${id} ${advisory.module_name}: remains reported`,
      );
    }
  }
  for (const severity of severities) {
    assert.equal(
      counts[severity],
      observed[severity],
      `Incomplete ${severity} audit report`,
    );
  }
  for (const patch of policy.patches) {
    assert(
      seen.has(patch.ghsa),
      `${patch.ghsa}: stale exception; remove or reassess`,
    );
  }
  return decisions;
}
