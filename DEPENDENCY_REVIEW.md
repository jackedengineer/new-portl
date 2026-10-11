# Dependency audit status

Reviewed: 2026-10-11 (Asia/Kolkata). Scope: Expo SDK 57, Express, Prisma/Better Auth, resident onboarding, native component testing and verified dependency backports.

`pnpm audit --audit-level=high` reports two high and three moderate advisories. The high findings are:

| Advisory                                                                 | Dependency path in this lockfile                    | Upstream status                                             |
| ------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------- |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Expo → Expo CLI → node-forge                        | RSA signature verification issue; no patched release listed |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Expo → Metro → metro-file-map → micromatch → braces | Nested-pattern stack exhaustion; no patched release listed  |

These packages are in mobile build/development/test tooling. Expo's certificate/signature helpers call Forge's verifier, so a tooling path is not a reason to dismiss the finding. The application does not directly use these packages for visitor credentials, authentication or API requests. Builds must use trusted inputs; Expo CLI and Metro must not be exposed as public production services.

## Verified temporary backports

The two high findings are mitigated using exact-version pnpm patches, not a fabricated package version or an unreviewed fork. See `patches/`, the installed-file/patch SHA-256 manifest in `scripts/security/patch-policy.json`, and the security regression suite. Patch application and unused-patch failures are fatal.

- **Forge 1.4.0:** enforce exact nested AlgorithmIdentifier element counts, empty NULL parameters when present, and canonical hash OID bytes. The nested-count check follows [upstream proposal #1152](https://github.com/digitalbazaar/forge/pull/1152), which remains unmerged. Additional tests showed that its count check alone still accepted nonempty NULL and padded/unterminated OIDs; the local patch rejects these equivalent ignored-byte forms at the same verification boundary. The library and both distributed browser bundles receive equivalent changes. Source maps remain upstream diagnostic assets. Valid SHA256 with omitted/empty NULL, standard Node signatures, mismatched digests, PSS, NONE and MD5's required NULL behavior are covered. Tests sign malformed structures with test-only keys and real PKCS#1 padding; they demonstrate parser-boundary acceptance/rejection, not an independently constructed private-key-free forgery.
- **Braces 3.0.3:** bound child-tree depth at 100, counting parentheses as well as braces. Parser guards prevent overflow before a tree is returned; iterative guards cover compile, expand and stringify, including direct library calls, caller-built AST child trees, child cycles and shared subtrees encountered at different depths. Options cannot disable the cap. Normal lists/ranges, escaping, quoting, shallow nesting and flat siblings remain supported. Patterns above the depth budget now throw a deliberate RangeError. This is a child-nesting mitigation, not a promise to bound all regular-expression or combinatorial expansion costs. Malformed caller-built parent metadata can still trigger pre-existing parent-chain loops; normal string parsing cannot produce that state. [Upstream report](https://github.com/micromatch/braces/issues/70).

Run `pnpm security:audit` for the CI security gate. It first verifies the patch files and every active installed copy in pnpm's dependency graph against the reviewed version and source hashes, then runs security/compatibility tests and collects **unfiltered** `pnpm audit --json`. It accepts only these two exact high advisory identities after those checks. It rejects new high/critical findings, changed versions/packages/severity, muted or malformed reports, registry failures, incomplete counts, stale exceptions and newly available upstream fixes. All moderate findings stay visible. No pnpm ignore list or `continue-on-error` is enabled; the raw `pnpm audit --audit-level=high` intentionally still exits 1 because the original version numbers remain.

The two exceptions expire at **2026-11-11 00:00 IST** (`2026-11-10T18:30:00Z`); CI fails at that boundary. Reassess both before then, and remove the patches, manifest entries and corresponding exceptions when compatible fixed releases are available. Expiry is enforced on the next check; no scheduled monitor is implied. A passing guarded gate is not a zero-advisory audit or a verified native/public release.

The moderate findings are `uuid` (GHSA-w5hq-g745-h8pq), `decode-uri-component` (GHSA-vcc3-ghjq-m6fr), and `sprintf-js` (GHSA-hp3w-g68c-fv3c). The last finding was introduced by Jest's coverage tooling through `@istanbuljs/load-nyc-config → js-yaml → argparse → sprintf-js`; the registry currently lists no patched version. It is a development/test path, not an API runtime dependency. These three findings are unresolved and have no exception entries. Reassess all five findings before release.

The native test stack uses Expo-matched `jest-expo ~57.0.5`, Jest 29.7, React Native Testing Library 13.3.3 and `react-test-renderer` 19.2.3 matching React 19.2.3. Better Auth and its Expo plugin are both pinned to 1.7.7, with `@better-auth/utils` 0.4.2 matching Better Auth's declared range. Native dependencies were installed using Expo's version resolver. Server production output excludes integration fixtures and test files.

## Reviewed integration fixes

Prisma 7.10.0 adds pinned tooling dependencies with advisories. Two narrowly scoped pnpm overrides are recorded with the lockfile:

- `prisma@7.10.0>mysql2` uses 3.23.1, addressing GHSA-3f6p-5ww8-9rcr and GHSA-rgwj-5xj2-c3m3. Portl uses PostgreSQL; no MySQL workflow is enabled. [Upstream patch](https://github.com/sidorares/node-mysql2/releases/tag/v3.23.1).
- `@prisma/config@7.10.0>deepmerge-ts` uses 8.0.0 for GHSA-ggr8-5vv4-36mx. This is a major override: reviewed changes affect deep Map merging, type names and input mutation; Portl's Prisma config contains plain records. Config loading, generation, migration status, builds and database tests verify the used path. [Upstream migration notes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0).

Remove these overrides when a stable Prisma update supplies equivalent fixes. They are targeted reviewed remediations, not advisory suppressions or a forced audit update.

Dependency lifecycle execution remains fail-closed. `@prisma/engines` was reviewed and allowlisted for its official engine downloader; Prisma's package preinstall is not broadly enabled. The generated client is rebuilt from the checked-in schema and is not committed. Better Auth/Prisma were selected as stable releases; Prisma's registry `latest` prerelease is deliberately excluded.

Root security scripts use Node 24's built-in TypeScript support and test runner, with pinned `@types/node` 24.19.2 for static checking. No new runtime dependency is added. Lockfile regeneration reuses the existing React Native Testing Library 13.3.3 peer resolution and removes the redundant optional 14.1.0/test-renderer graph; it does not upgrade the application frameworks.
