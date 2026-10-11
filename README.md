# Portl

An Expo / React Native society management app with a TypeScript / Express backend. Implemented slices include email OTP login, resident admission, guard visitor registration, resident decisions and distinct entry/exit history across independent societies. Society authority is granted only by a valid invitation or an admin approval.

## Local development

Use Node 24 (the pinned development version is in `.node-version`) and pnpm 10.34.5.

```sh
pnpm install --frozen-lockfile
pnpm --filter @portl/server db:generate
pnpm --filter @portl/server db:migrate
pnpm --filter @portl/server db:jobs:init
pnpm --filter @portl/server db:provision
pnpm dev:api
```

First create the ignored environment files from their examples if they do not exist, and configure the development credentials described in [environment setup](ENVIRONMENT.md). Generate the Prisma client after installation. Migrations use the direct owner connection; provisioning creates a restricted runtime role and updates the local `DATABASE_URL` and `WORKER_DATABASE_URL`. API startup rejects privileged runtime roles. Never run development migrations or integration tests against production.

In another terminal:

```sh
pnpm dev:mobile
```

The app uses Expo Router, TanStack Query, shared Zod contracts and Better Auth's Expo client. Native session cookies use SecureStore; cached profiles cannot authorize access. Set the device-reachable API origin in the ignored mobile environment file and restart Metro after changes. A browser preview also requires its exact origin in the server's `TRUSTED_ORIGINS` (for example `http://localhost:8081`). The generated template icons and native identifiers remain release setup tasks. Signed development builds and physical-device verification are still required.

For an iPhone running Expo Go on the same Wi-Fi, follow [physical-device setup](ENVIRONMENT.md#physical-iphone-testing-with-expo-go), then run `pnpm --filter @portl/mobile exec expo start --go --lan --port 8081` alongside the API. Expo Go needs an exact development-only `exp://` auth origin and a LAN-reachable API URL; a localhost API URL points at the phone itself. Sign in to Expo Go with the same Expo account as the CLI and scan Metro's QR using the iPhone Camera.

`GET /health/live` reports process liveness; `/health/ready` checks database connectivity. Neither verifies email delivery. Better Auth mounts under `/api/auth`; `/v1/me` returns a protected identity and current membership projection. A new verified identity can apply using a society code or accept an invitation addressed to its verified email. Pending applications grant no society access. Admin review and invitation management require an active admin membership and a recent authenticator verification.

## Provision demo societies and the first administrator

There is no public endpoint for creating societies or granting admin roles. Use the controlled development bootstrap with the migration-owner connection; never put that connection in the API or mobile app.

1. Copy `apps/server/bootstrap.example.json` to an ignored file under `apps/server/.local/`, replace the synthetic email, society codes and flat list, and restrict the file to mode `0600`.
2. Run `pnpm --filter @portl/server db:bootstrap prepare .local/your-config.json` from the repository root. The generated private pending file contains an authenticator enrollment URI; import it into your authenticator app. It is a credential: do not paste it into chat, Git, logs or screenshots.
3. Run `pnpm --filter @portl/server db:bootstrap confirm .local/bootstrap.pending.json` and enter a current authenticator code at the prompt. Only a successful confirmation creates the initial demo societies and admin membership. The pending credential file is then removed.
4. Start the API and sign in with that admin email. In the society card, choose **Manage resident onboarding**, verify the authenticator code, then review applications or create invitations.

Bootstrap refuses to replace an existing authenticator. Credential recovery and production society provisioning require a separate operator procedure before a public launch. Invitations are shared manually using the device share sheet; only OTPs are delivered through Resend. Invitation codes are shown once, email-bound, single-use and expire after seven days. Multiple verified household members can share a flat; `OWNER`/`TENANT` is the recorded residency relationship, not proof of legal ownership.

## Visitor operations

After signing in, an assured admin can open **Gate access** under society administration, create a gate and assign a guard’s already verified email account. Assigned guards can register guest, delivery, cab and service arrivals for an active flat. Any current resident captured for that flat can approve or reject; the first decision wins. Guards separately confirm physical entry and exit. Residents and admins can view the relevant movement history.

Pending arrivals expire after 10 minutes. Approval permits one entry within 30 minutes; it does not mark the visitor inside. The API rechecks the approving resident’s original occupancy before entry. Foreground screens refresh every 5 seconds; reconnect before taking action. Residents can also create scheduled guest passes for their own flat, reveal/share a 16-character code and revoke it before entry. Guards verify a presented code and separately confirm one entry and one exit; existing presence survives pass expiry. Codes never appear in history or URLs. Mobile push opt-in, QR scanning and manual overrides follow in later slices.

## Notification backend

Gate source changes now create private notification inbox rows and durable pg-boss jobs in the same transaction. Visitor requests target their current captured household; decisions target assigned guards; movement updates target original eligible residents or the guest-pass issuer. Authenticated `/v1/notifications` list/detail/read routes return minimal private DTOs; device registration/removal binds encrypted tokens to actual live sessions and installation generations.

Run `pnpm --filter @portl/server dev:worker` separately after migration, `db:jobs:init` and `db:provision`. The API and worker use distinct restricted database roles. The worker retries transient errors, checks provider receipts and rechecks current authorization before sending generic Expo push. It cannot write auth/gate business tables. No real provider/device delivery is claimed. Mobile inbox/push opt-in and Android EAS/Firebase preparation follow in a dependent PR.

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

Architectural specifications and their frozen version history remain outside this Git checkout. This increment corresponds to specification edition 1.8.0 (CHG-0009); specification editions are independent of app versions. Community modules, mobile notification UI, account deletion/privacy flows, production provisioning/recovery and store releases remain future slices. Before public deployment, resolve privacy/retention, native-device, guest-code re-encryption on root-secret rotation and Railway proxy configuration gates.
