# Dependency audit status

Reviewed: 2026-10-10. Scope: initial Expo SDK 57 and Express bootstrap, before authentication or personal-data storage is implemented.

`pnpm audit --audit-level=high` reports two high and two moderate advisories. The high findings are:

| Advisory                                                                 | Dependency path in this lockfile                    | Upstream status                                             |
| ------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------- |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Expo → Expo CLI → node-forge                        | RSA signature verification issue; no patched release listed |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Expo → Metro → metro-file-map → micromatch → braces | Nested-pattern stack exhaustion; no patched release listed  |

These paths are in the mobile build/development tooling. This is a dependency-path observation, not proof that every affected operation is unreachable. The application does not use these packages directly for visitor credentials, authentication or API requests. Expo's CLI and Metro must not be exposed as public production services. Builds must use trusted configuration and source inputs.

No advisories are ignored, no unverified package overrides are applied, and the CI dependency-audit job fails while high findings remain. Recheck upstream fixes or review and test a remediation before enabling release automation. Local lint, type checks, API tests and JavaScript export passing does not imply a clean security audit or a verified native release.
