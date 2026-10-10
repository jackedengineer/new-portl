# Portl

An Expo / React Native society management app with a TypeScript / Express backend. This repository currently contains the mobile shell and API foundation. Email OTP, database persistence, role dashboards and society workflows are the next development slices.

## Local development

Use Node 24 (the pinned development version is in `.node-version`) and pnpm 10.34.5.

```sh
pnpm install --frozen-lockfile
cp apps/server/.env.example apps/server/.env
cp apps/mobile/.env.example apps/mobile/.env.local
pnpm dev:api
```

Only copy the templates when the local files do not exist; do not replace values already configured. See [environment setup](ENVIRONMENT.md) for provider credentials, generated secrets and their storage. The initial scaffold runs without provider credentials.

In another terminal:

```sh
pnpm dev:mobile
```

The current mobile shell can run in a compatible Expo Go installation. Better Auth SecureStore integration and push notifications will be tested using development builds when added. Native app identifiers, signing and store release configuration will be selected before those builds; the generated template icons are placeholders.

`GET /health/live` reports API process liveness only. It does not report database or email readiness. Business endpoints will use `/v1`; Better Auth will mount under `/api/auth`.

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build:server
pnpm format:check
pnpm --filter @portl/mobile exec expo export --platform ios --platform android
```

Export verifies JavaScript bundling. It does not replace signed native builds or device tests. Database integration tests and mobile component/device tests will be introduced with their corresponding behavior.

GitHub Actions runs these checks on pushes to `main` and pull requests. A separate dependency-audit job reports upstream issues without hiding them; see [the current dependency review](DEPENDENCY_REVIEW.md). Deployment and store submission are not enabled by this workflow. Branch protection and required check settings must be configured before merging later feature pull requests.

Architectural specifications and their frozen version history are maintained outside this Git checkout. The current scaffold refines specification edition 1.1.0 (CHG-0002); specification editions are independent of app versions.
