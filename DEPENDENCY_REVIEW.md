# Dependency audit status

Reviewed: 2026-10-10. Scope: Expo SDK 57, Express and the Prisma/Better Auth backend OTP slice.

`pnpm audit --audit-level=high` reports two high and two moderate advisories. The high findings are:

| Advisory                                                                 | Dependency path in this lockfile                    | Upstream status                                             |
| ------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------- |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Expo → Expo CLI → node-forge                        | RSA signature verification issue; no patched release listed |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Expo → Metro → metro-file-map → micromatch → braces | Nested-pattern stack exhaustion; no patched release listed  |

These paths are in the mobile build/development tooling. This is a dependency-path observation, not proof that every affected operation is unreachable. The application does not use these packages directly for visitor credentials, authentication or API requests. Expo's CLI and Metro must not be exposed as public production services. Builds must use trusted configuration and source inputs.

No advisories are ignored, and the CI dependency-audit job fails while high findings remain. Recheck fixes before release automation. Local checks passing does not imply a clean security audit or a verified native release.

## Reviewed integration fixes

Prisma 7.10.0 adds pinned tooling dependencies with advisories. Two narrowly scoped pnpm overrides are recorded with the lockfile:

- `prisma@7.10.0>mysql2` uses 3.23.1, addressing GHSA-3f6p-5ww8-9rcr and GHSA-rgwj-5xj2-c3m3. Portl uses PostgreSQL; no MySQL workflow is enabled. [Upstream patch](https://github.com/sidorares/node-mysql2/releases/tag/v3.23.1).
- `@prisma/config@7.10.0>deepmerge-ts` uses 8.0.0 for GHSA-ggr8-5vv4-36mx. This is a major override: reviewed changes affect deep Map merging, type names and input mutation; Portl's Prisma config contains plain records. Config loading, generation, migration status, builds and database tests verify the used path. [Upstream migration notes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0).

Remove these overrides when a stable Prisma update supplies equivalent fixes. They are targeted reviewed remediations, not advisory suppressions or a forced audit update.

Dependency lifecycle execution remains fail-closed. `@prisma/engines` was reviewed and allowlisted for its official engine downloader; Prisma's package preinstall is not broadly enabled. The generated client is rebuilt from the checked-in schema and is not committed. Better Auth/Prisma were selected as stable releases; Prisma's registry `latest` prerelease is deliberately excluded.
