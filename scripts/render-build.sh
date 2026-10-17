#!/usr/bin/env bash
set -euo pipefail

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable
fi
# Keep backend builds independent of the mobile native dependency tree.
pnpm install --frozen-lockfile --prod=false --filter portl --filter '@portl/server...'
# Generation reads Prisma config but needs no database access or owner credential.
DIRECT_DATABASE_URL=postgresql://build:build@127.0.0.1:5432/unused pnpm --filter @portl/server db:generate
pnpm build:server
