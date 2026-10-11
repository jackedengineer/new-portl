# Environment and credential setup

Use separate development, staging and production resources and secrets. Start with development only. Put local values in `apps/server/.env` and `apps/mobile/.env.local`; both are ignored by Git. Do not send secret values in chat. Railway will hold deployed server secrets; EAS will hold build credentials.

## Active: email OTP and the database

| Variable              | Where it comes from                                               | Purpose                                                                |
| --------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`        | Neon development branch, pooled URL for a restricted runtime role | API database access; no schema ownership, superuser or RLS bypass      |
| `DIRECT_DATABASE_URL` | Same Neon branch, direct URL for the migration role               | Prisma schema migrations; never distributed to the mobile app          |
| `BETTER_AUTH_SECRET`  | Generate locally using cryptographic randomness                   | Better Auth server secret; already generated in the local ignored file |
| `RESEND_API_KEY`      | Resend API keys; restrict to sending for the verified domain      | Deliver OTP messages from the server                                   |
| `EMAIL_FROM`          | An address under your verified domain                             | Initial selection: `Portl <auth@jacked.dev>`                           |

The development database has `portl_auth`, `portl_registry`, `portl_gate`, `portl_notifications` and `portl_jobs` schemas and a separate runtime role. Provisioning grants CRUD on nine auth/security tables and narrow registry, gate, inbox and queue-producer access. A separate worker role can claim jobs, update delivery results and call checked notification RPCs; it cannot write business/auth tables. Registry tables enforce RLS, composite tenant foreign keys and transaction-local identity/society context; runtime audit access is append-only. The runtime has no schema/table ownership, migration-history access, superuser, role/database creation or RLS bypass. After every migration, rerun `db:provision` to apply new grants to the existing role. The Railway API receives `DATABASE_URL`, while the worker receives only `WORKER_DATABASE_URL` for database access; keep `DIRECT_DATABASE_URL` in a separate migration job/secret context. Do not run development migrations against production.

If the restricted runtime role does not exist yet, fill `DIRECT_DATABASE_URL` first. We can provision that role during database setup and then populate `DATABASE_URL`.

Better Auth creates and verifies OTPs and establishes sessions. Resend delivers email through its API. There is no separate Better Auth SaaS API key, password-login credential or mailbox password. Add `jacked.dev` (or a dedicated sending subdomain) to Resend and publish its verification DNS records. Your Gmail address can receive test messages; it cannot be a Resend From address because you do not control `gmail.com`.

## Configuration we supply

`BETTER_AUTH_URL` is the backend base URL. `TRUSTED_ORIGINS` is the exact auth allowlist, initially `portl://`; production accepts HTTPS web origins and the app scheme. `EXPO_PUBLIC_API_URL` is the device-reachable backend URL. These URLs are public configuration. Startup validates the active database, auth and email fields; missing configuration fails startup.

For local URLs use `http://localhost:3000` on an iOS simulator, `http://10.0.2.2:3000` on the standard Android emulator, or the computer's LAN address on a physical device. Deployed URLs use HTTPS. Do not commit a development transport exception into release builds.

## Physical iPhone testing with Expo Go

Connect the Mac and iPhone to the same Wi-Fi network. Use `ipconfig getifaddr en0` to find the Mac's Wi-Fi address (adjust the interface if Wi-Fi is not `en0`). In the ignored environment files, replace `<LAN_IP>` with that address:

```dotenv
# apps/server/.env
NODE_ENV=development
HOST=0.0.0.0
BETTER_AUTH_URL=http://<LAN_IP>:3000
TRUSTED_ORIGINS=portl://,exp://<LAN_IP>:8081

# apps/mobile/.env.local
EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000
```

Keep the existing database, auth secret and email credentials. Expo Go's Better Auth client sends its `exp://` origin; the API accepts only explicitly listed origins, with no wildcard matching. Exact Expo Go origins are permitted only in development. Test and production configuration reject them. The installed app continues to use `portl://`. Update the exact allowlist if Metro's address or port changes.

Run `pnpm dev:api` and, in a second terminal, `pnpm --filter @portl/mobile exec expo start --go --lan --port 8081`. Restart both after changing their environment files. Update Expo Go to an SDK 57 compatible version and sign in using the same Expo account shown by `pnpm --filter @portl/mobile exec expo whoami`. Scan Metro's QR with the iPhone Camera and allow Expo Go Local Network access if prompted. Keep the Mac awake and both processes running. `http://<LAN_IP>:3000/health/ready` in iPhone Safari checks API connectivity before login.

Expo Go downloads the development JavaScript bundle; it does not install a Portl `.ipa` or verify signed release behavior. A Metro tunnel would not also tunnel the local API. The notification inbox works here. Push delivery, signed builds and release verification remain separate work. There is no public role selector: a new email starts onboarding, and role workflows require actual invitation/approval or controlled demo provisioning. See the README's first-administrator bootstrap procedure.

## Auth behavior and deployment gates

Only send-login-OTP, sign-in-with-OTP, get-session, sign-out and authenticator verification are exposed under `/api/auth`. Codes have six digits, five-minute expiry, three verification attempts and HMAC-SHA256 storage keyed by the server secret. Sending is limited to once per email per 60 seconds and five per hour; IP budgets are three sends per minute and ten verification requests per ten minutes. Database-backed limits arbitrate concurrent API processes. Sessions expire after seven days and refresh at most daily; database revocation is checked without a cookie cache. Native cookies are stored through Better Auth's Expo client in SecureStore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; the application query cache is memory-only and cleared between identities.

Administrator operations require session-bound TOTP assurance lasting 15 minutes, with five attempts per minute and fifteen per hour per account, and an atomic 90-second replay claim. No trusted-device, email-factor fallback or HTTP enrollment/recovery endpoint is enabled. The controlled development bootstrap requires a confirmed authenticator before granting the first admin membership; see the README. Its private pending file and direct owner credentials must stay outside source control. Production enrollment, revocation and factor recovery remain operator-design release gates. Existing membership revocation is checked on each admin operation; mobile navigation is not an authorization boundary.

Email sends are synchronous with a ten-second provider timeout. A provider acceptance is not a delivery confirmation. Delivery failure returns a safe 503 and removes the matching unused challenge. No queued plaintext OTP, password endpoint, universal test code or automatic role grant exists. Automated tests replace only the email transport.

Express currently trusts the socket address and overwrites the internal auth IP header. Before deploying behind Railway, verify its ingress/proxy behavior and implement a constrained, tested proxy trust configuration. Otherwise requests can share one proxy IP and legitimate users can hit a shared limit. Never enable blanket trust of client forwarding headers. Auth/throttle expiry cleanup, account deletion, operator recovery and physical-device SecureStore verification remain release gates. Credentialed browser CORS is restricted to exact configured origins; JSON domain mutations also enforce the trusted origin or native `expo-origin`.

The local integration runner reads ignored `.env` values without printing them and uses only synthetic test records. Prefer a separate Neon test branch. CI's published `portl-ci-only` password belongs to its disposable loopback database; it is not a deployment credential.

## Notifications and Android development builds

Notification development adds `WORKER_DATABASE_URL`, a separately provisioned restricted role on the same database. Run the following in order against an isolated development database; `db:provision` remains a development operator command. Production provisioning needs a reviewed operator runbook, rather than setting `NODE_ENV=development` on deployed services.

```sh
pnpm --filter @portl/server db:generate
pnpm --filter @portl/server db:migrate
pnpm --filter @portl/server db:jobs:init
pnpm --filter @portl/server db:provision
pnpm --filter @portl/server dev:worker
```

`db:jobs:init` uses the direct migration owner to initialize the pinned pg-boss schema/queues. Runtime schema migration is disabled. A production worker uses `pnpm --filter @portl/server start:worker` after `pnpm build:server`; run it as a separate Railway service with `WORKER_DATABASE_URL`, `BETTER_AUTH_SECRET`, optional `EXPO_ACCESS_TOKEN`, `NODE_ENV` and `LOG_LEVEL`. It does not need Resend credentials or the migration URL. API and worker must share the auth root secret for encrypted push tokens. Plan re-encryption for tokens and guest passes before rotating that secret.

| Configuration                | Purpose and storage                                                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | Real Expo project UUID; public mobile/EAS environment value. No placeholder is committed.                                                                                           |
| `GOOGLE_SERVICES_JSON`       | Path to Firebase Android **client configuration**, e.g. `.local/google-services.json`, or the path supplied by an EAS file environment variable. This is not a service-account key. |
| FCM v1 service-account JSON  | Private Google credential uploaded via EAS Credentials for `dev.jacked.portl`. Never bundle it or put it in a public variable.                                                      |
| `EXPO_ACCESS_TOKEN`          | Worker-only bearer credential if Expo enhanced push security is enabled. Distinct from the EAS automation `EXPO_TOKEN`.                                                             |

For Android, create a Firebase project, register Android package `dev.jacked.portl`, download its client configuration and upload its FCM v1 service-account key through EAS Credentials. Configure the real EAS project ID and device-reachable API URL locally and in the matching EAS environment. Ignored files are not uploaded automatically: provide `GOOGLE_SERVICES_JSON` as an EAS file variable for cloud builds, plus a local copy for local config evaluation. Rebuild after adding/changing native Firebase configuration.

Run these owner setup/build commands from `apps/mobile` after configuring Firebase and EAS:

```sh
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest credentials --platform android
npx eas-cli@latest build --platform android --profile development
pnpm exec expo start --dev-client --lan --port 8082
```

Dynamic app configuration reads the project UUID from `EXPO_PUBLIC_EAS_PROJECT_ID`; if `eas init` requests a manual config edit, use the actual UUID it returns in that variable. The development profile produces an internal APK with Expo Dev Client; preview produces an internal release APK; production uses normal store outputs. Each selects its matching EAS environment. Preview/production need an HTTPS API. No global Android cleartext or iOS transport exception is added for release builds.

Install the APK on a physical Android device with Google Play services, sign in, open **Community → Notifications** and explicitly enable push. Grant OS permission. Send a visitor request from a separate guard session; background/tap/cold-start, approve/reject, entry/exit, opt-out, logout and account-switch journeys all need device evidence. Foreground events refresh the inbox; they intentionally do not display duplicate OS banners. Missed/denied push leaves the inbox usable. Expo receipts mean provider processing, not user display/read. No public Play release is needed for this internal APK test.

The full owner Firebase checklist and remaining v1 sequence are maintained in the external specification set (`testing/ANDROID-NOTIFICATIONS.md`, edition 1.8.0). Firebase/EAS setup, real signed builds and push delivery are pending; a successful JavaScript export does not verify native delivery.

## Prepare later; not needed to start

| Integration            | Credentials / configuration                                                                                                                             | Storage                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Private S3 attachments | `AWS_REGION`, `S3_BUCKET_NAME`, scoped `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (or temporary workload credentials)                              | Server/worker only                                                                |
| Sentry                 | Server `SENTRY_DSN`, mobile `EXPO_PUBLIC_SENTRY_DSN`; upload token `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` when enabling source-map uploads | DSNs at runtime; upload token only in build/CI secrets                            |
| Expo / EAS             | Expo account access, EAS project ID, CI `EXPO_TOKEN` if we automate builds                                                                              | Project ID in app config; token in CI only                                        |
| Expo Push              | Server `EXPO_ACCESS_TOKEN` if enhanced push security is enabled                                                                                         | Server/worker only; not the EAS CI variable                                       |
| Android push           | Firebase project and FCM v1 service-account credential; mobile `google-services.json` configuration                                                     | FCM credential through EAS credential management; public mobile config separately |
| iOS push               | Apple Developer team and APNs signing key                                                                                                               | EAS credential management                                                         |
| Railway                | Project access and GitHub repository connection; automation token only if needed later                                                                  | Railway / CI, not mobile env                                                      |
| Google Play release    | Play Console access and scoped Android Publisher service account for EAS Submit                                                                         | EAS / CI credential management                                                    |
| Apple release          | Apple Developer / App Store Connect access, team ID and App Store Connect API key for submission                                                        | EAS / CI credential management                                                    |
| Public support pages   | Backend domain, privacy/support/deletion URLs and contact address                                                                                       | Public configuration                                                              |

Store signing and publishing credentials are files/account permissions as well as environment variables. Do not flatten every credential into an `.env` file. Use service credentials rather than sharing personal account passwords. No payment, SMS, Redis, Firebase Auth or social-login credentials are needed for v1.

## Official references

- [Better Auth setup and secret](https://better-auth.com/docs/installation)
- [Better Auth email OTP](https://better-auth.com/docs/plugins/email-otp)
- [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction)
- [Expo environment variables and public values](https://docs.expo.dev/guides/environment-variables/)
- [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [EAS credentials](https://docs.expo.dev/app-signing/app-credentials/)
