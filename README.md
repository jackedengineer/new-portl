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

## Live gate updates

Focused visitor queues and detail screens use Socket.IO to refresh immediately after an arrival, decision, cancellation, entry or exit commits. The server checks the current session, society role and request audience before each minimal change signal. REST remains authoritative; reconnects refresh state and the five-second polling fallback recovers missed signals. Background push continues through the separate worker.

Run one API process/replica for this release. Live signals are process-local; scaling replicas requires a shared adapter and another review. Connections, outstanding authorization checks and queued work are bounded; slow transports drop optional signals. Socket.IO uses the existing API origin/port and supports WebSocket plus HTTP polling. No database migration, new credentials or native rebuild is required for this JavaScript-only addition. Guest-pass screens retain their existing polling behavior. Test resident and guard screens on separate sessions, including loss of Wi-Fi and return from the background, before claiming device acceptance.

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

Architectural specifications and their frozen version history remain outside this Git checkout. This reviewer-access revision corresponds to specification edition 3.4.0 (CHG-0017); specification editions are independent of app versions. The owner deferred polls, helpdesk and amenities/bookings after v1. The API and worker are deployed on Railway with Neon production; the production privacy revision is live; reviewer access still requires coordinated migration, grants, deployment and private provisioning. Android development APK installation and push receipt are owner-confirmed. Signed store builds, physical-device acceptance of newer flows, real-society retention/moderation, independent backup/restore acceptance and guest-code re-encryption on root-secret rotation remain release work.

## Account and privacy

**Community → Account & privacy** provides current 18+ policy acceptance, public disclosure links, active-session revocation, verified email change and deletion. Email change proves both mailboxes and signs out all sessions. Deletion verifies a separate email code and literal `DELETE`, immediately revokes access, then erases account-created content through the restricted worker. The private receipt screen tracks completion without login. Sole-admin deletion proceeds; restoration of administration requires a separately verified operator procedure.

Public `/privacy`, `/terms`, `/support` and `/delete-account` pages are served by the API. The revised production privacy notice describes Railway API/worker hosting in California, Neon PostgreSQL in Singapore, the verified six-hour Neon restore-history setting, provider retention, optional push and the limits of deletion. Production URLs are https://api.portl.jacked.dev/privacy and https://api.portl.jacked.dev/delete-account. The source update must be deployed before those live pages reflect it; store declarations and backup/restore acceptance remain release work. Update API, worker and mobile together: sign-in now requires explicit current policy acceptance. For the 2026-10-14 policy revision, apply migration `202610140001_production_privacy_policy` with the controlled migration-owner connection before deploying the API and matching mobile bundle. It updates only recovery policy guards and preserves grants, data and earlier acceptance records. Existing accounts must explicitly accept the revised policy; old mobile bundles must be reloaded/replaced. No new runtime credential, role provisioning or native dependency is needed for this revision.

The lifecycle worker persists private hashed-ID recovery records before erasure. Production requires either `ACCOUNT_DELETION_LEDGER_DIR` on a durable private volume or `ERASURE_LEDGER_DATABASE_URL` with restricted credentials for a dedicated independent Neon project; see [environment setup](ENVIRONMENT.md#account-lifecycle-worker). Loss or corruption blocks erasure while access remains revoked; unrelated notification work can continue. Never use an ephemeral hosting directory or a schema in the business database for this ledger. Never commit these records or roll the ledger back alongside a business database restore.

## Operator-assisted admin recovery

Recovery supports a lost admin authenticator and an unarchived society with no active admin. An operator first verifies identity and society authority outside the app, records a private case reference, then runs `pnpm --filter @portl/server db:recovery prepare .local/recovery.json` using the migration-owner connection. Copy `apps/server/recovery.example.json` to that ignored mode-0600 file and replace its placeholders only after completing the documented checks. `RESET_AUTHENTICATOR` omits `societyId`; `RESTORE_ADMIN` requires the exact society ID. There is no public preparation endpoint.

Preparation sends a five-minute recovery email code and grants no authority. The recipient signs in and completes **Account & privacy → Admin recovery** with that code, a newly enrolled authenticator and explicit `RECOVER`. Completion atomically replaces the account's admin factor, restores only the selected society when eligible, and revokes all sessions/devices. Normal admin actions still require a fresh sign-in and authenticator step-up. Lost-mailbox replacement is excluded.

Inspect or cancel a case using `db:recovery status <case-id>` or `db:recovery cancel <case-id>`. No operator command prints enrollment keys or email codes. New migrations and runtime provisioning are required; no new dependency, provider credential or native rebuild is introduced. Detailed identity-check, cancellation and device acceptance procedures remain in the external specifications (edition 3.1.0 / CHG-0014).

## Store reviewer access

A visible **Reviewer access** entry signs into operator-managed Resident, Guard and Admin identities in one fictional society. Normal email OTP and personal admin authenticators remain unchanged. Review keys never belong in source, app bundles or public documentation. Review identities cannot join ordinary societies, change email, enroll recovery or request personal account deletion. Shared activity and these limits are disclosed before login and at `/reviewer-access`.

After the reviewer migration and restricted runtime grants are deployed, an operator can use `pnpm --filter @portl/server db:reviewer create /absolute/private/path/access.json` with the controlled migration-owner connection with RLS bypass and the API's auth secret. The parent folder must exist outside every Git checkout; the command creates a new mode-0600 file without printing keys and refuses existing realms/files. It seeds two towers, four flats, one gate, a directory entry and a published fictional notice. No human policy acceptance is seeded. Do not run this development setup against production without the separate reviewed rollout.

`db:reviewer rotate RESIDENT /absolute/private/path/new-access.json` (or `GUARD` / `ADMIN`) rotates that role's key and revokes its sessions/devices. `db:reviewer disable` disables the realm and revokes all review sessions/devices; `enable` reopens it without restoring revoked sessions. Rotation and activation serialize with sign-in, reauthentication and domain operations on the account lock. A failed create stays disabled until its credential file is durable; a failed key-file write after rotation requires another rotation into a new file. These commands never reset society content or regrant removed memberships. Restore fictional workflow state deliberately before review and avoid changes while review is active. Submit keys privately through the store's App access instructions, including admin reauthentication and sign-out/role-switch steps. Keep access available throughout review.
