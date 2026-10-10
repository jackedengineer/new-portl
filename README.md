# Portl

An Expo / React Native society management app with a TypeScript / Express backend. The backend now supports Better Auth email OTP with PostgreSQL sessions and Resend delivery. The mobile app remains a shell; its login screens, society onboarding and role workflows are upcoming slices.

## Local development

Use Node 24 (the pinned development version is in `.node-version`) and pnpm 10.34.5.

```sh
pnpm install --frozen-lockfile
pnpm --filter @portl/server db:generate
pnpm --filter @portl/server db:migrate
pnpm --filter @portl/server db:provision
pnpm dev:api
```

First create the ignored environment files from their examples if they do not exist, and configure the development credentials described in [environment setup](ENVIRONMENT.md). Generate the Prisma client after installation. Migrations use the direct owner connection; provisioning creates a restricted runtime role and updates only the local `DATABASE_URL`. API startup rejects privileged runtime roles. Never run development migrations or integration tests against production.

In another terminal:

```sh
pnpm dev:mobile
```

The current mobile shell can run in a compatible Expo Go installation. Better Auth SecureStore integration and push notifications will be tested using development builds when added. Native app identifiers, signing and store release configuration will be selected before those builds; the generated template icons are placeholders.

`GET /health/live` reports process liveness; `/health/ready` checks database connectivity. Neither verifies email delivery. Better Auth mounts under `/api/auth`; `/v1/me` returns a protected identity projection. New verified identities have no memberships or society authority. The membership module will implement invitation acceptance and admin-approved resident applications.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @portl/server test:integration
pnpm build:server
pnpm format:check
pnpm --filter @portl/mobile exec expo export --platform ios --platform android
```

Integration tests use real PostgreSQL and synthetic identities with a fake email transport. They require a migrated, isolated development/test database and a restricted runtime role. `PORTL_TEST_DATABASE_URL` overrides the local `DATABASE_URL`; tests do not send real email. CI provisions its own ephemeral Postgres instance and runtime role. Export verifies JavaScript bundling; signed native builds and device journeys remain pending.

GitHub Actions runs these checks on pushes to `main` and pull requests. A separate dependency-audit job reports upstream issues without hiding them; see [the current dependency review](DEPENDENCY_REVIEW.md). Deployment and store submission are not enabled by this workflow. Branch protection and required check settings must be configured before merging later feature pull requests.

Architectural specifications and their frozen version history remain outside this Git checkout. This increment corresponds to specification edition 1.2.0 (CHG-0003); specification editions are independent of app versions. Before public deployment, resolve the documented privacy/retention, admin step-up, demo provisioning and Railway proxy configuration gates.
