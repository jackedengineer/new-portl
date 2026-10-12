# Portl

An Expo / React Native society management app with a TypeScript / Express backend. Implemented slices include email OTP login, resident admission, guard visitor registration, resident decisions, entry/exit history, notifications, society notices and society administration/directory APIs across independent societies. Society authority is granted only by a valid invitation or an admin approval.

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

The app uses Expo Router, TanStack Query, shared Zod contracts and Better Auth's Expo client. Native session cookies use SecureStore; cached profiles cannot authorize access. Set the device-reachable API origin in the ignored mobile environment file and restart Metro after changes. A browser preview also requires its exact origin in the server's `TRUSTED_ORIGINS` (for example `http://localhost:8081`). The generated template icons remain a release setup task. Native identifiers are configured as `dev.jacked.portl`; Firebase, EAS ownership and store registration remain owner setup. Signed development builds and physical-device verification are still required.

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

Pending arrivals expire after 10 minutes. Approval permits one entry within 30 minutes; it does not mark the visitor inside. The API rechecks the approving resident’s original occupancy before entry. Foreground screens refresh every 5 seconds; reconnect before taking action. Residents can also create scheduled guest passes for their own flat, reveal/share a 16-character code and revoke it before entry. Guards verify a presented code and separately confirm one entry and one exit; existing presence survives pass expiry. Codes never appear in history or URLs. QR scanning and manual overrides remain later slices.

## Notifications

Visitor requests notify their current captured household; resident decisions notify guards assigned to the request's gate. Entry/exit events notify the original eligible resident recipients; guest-pass movements notify the eligible issuer. **Community → Notifications** provides a persistent private inbox with unread state and authorized links to current resources. Gate state, inbox rows and pg-boss jobs commit in one database transaction. Push is optional and generic: no visitor names, flat numbers or pass codes go to Expo.

Start a separate worker after database setup:

```sh
pnpm --filter @portl/server dev:worker
```

API and worker use different restricted roles; only an operator initializes/migrates the queue schema. The worker rechecks live sessions, membership/assignment lifetimes and original occupancy before dispatch, retries transient failures and processes Expo receipts. Delivery is at least once; a push never approves entry or proves a resident read it. See [notification setup](ENVIRONMENT.md#notifications-and-android-development-builds) for credentials and deployment commands.

Expo Go supports the inbox, but Portl push needs an installed development build, a real EAS project and Android FCM v1 credentials. The prepared development/preview APK profiles do not mean a signed APK has been built or push tested. iPhone push requires Apple Developer/APNs setup. Neither Firebase nor an EAS project is provisioned by this change.

## Society notices

Admins with recent authenticator verification can open **Manage society notices** from Community, save and edit plain-text drafts, review before publishing to the whole society, and archive drafts or published notices. Published text is immutable; archive and create a new notice for a correction. Residents open **Society notices** to read currently published updates. Guards have no notice-board access through their guard role.

Publishing captures current residents once and commits the notice, audit, private inbox items and batched push jobs together. A resident with several flats receives one event. Newly admitted residents can read existing published notices without receiving historical publish alerts. Archiving hides the notice and its inbox events from residents and suppresses pending delivery; an already delivered OS notification cannot be recalled.

This increment adds migration `202610120001_society_notices`. Generate Prisma, apply migrations with the owner connection, initialize queues if not already set up, and rerun runtime/worker provisioning before starting the updated services. No new environment keys or dependencies are required. Update API, worker and mobile together before publishing notices: older mobile notification schemas do not understand `NOTICE_PUBLISHED`. Existing visitor and guest-pass endpoints retain their contracts. Physical-device notice and push checks remain required.

## Society administration and directory

Assured admins can manage towers/flats, inspect current/ended residencies, end one flat’s residency and manage staff/service-provider contacts. Archival preserves history and rejects structures still in use. Ending a resident’s last flat revokes only that society’s resident access and outstanding resident invitations; other roles and societies remain intact. Directory records never grant login or gate access. Phone numbers are private by default and become resident-visible only after explicit admin sharing; guard-only accounts cannot read the directory.

Apply migrations and rerun runtime provisioning before starting the updated API. With the matching mobile increment, open **Community → Society overview** for administration or **Community → Community directory** as a resident. No new credentials, dependencies or native plugins are required. Use an isolated development database for tests; new-screen device acceptance remains separate from automated checks.

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

Integration tests use real PostgreSQL and synthetic identities with a fake email transport. They require a migrated, isolated development/test database and a restricted runtime role. `PORTL_TEST_DATABASE_URL` overrides the local `DATABASE_URL`; tests use fake email and push transports and do not contact providers. CI provisions its own ephemeral Postgres instance and runtime role. Export verifies JavaScript bundling; signed native builds and device journeys remain pending.

GitHub Actions runs these checks on pushes to `main` and pull requests. A separate dependency-audit job reports upstream issues without hiding them; see [the current dependency review](DEPENDENCY_REVIEW.md). Deployment and store submission are not enabled by this workflow. Branch protection and required check settings must be configured before merging later feature pull requests.

Architectural specifications and their frozen version history remain outside this Git checkout. This increment corresponds to specification edition 2.0.0 (CHG-0011); specification editions are independent of app versions. The owner deferred polls, helpdesk and amenities/bookings after v1. Authorized live signals, account deletion/privacy flows, production provisioning/recovery and signed store releases remain v1 work. Android development APK installation and notification receipt are owner-confirmed; that does not establish acceptance of these new screens or release builds. Before public deployment, resolve privacy/retention, guest-code re-encryption on root-secret rotation and Railway proxy configuration gates.
