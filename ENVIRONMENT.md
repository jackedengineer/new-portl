# Environment and credential setup

Use separate development, staging and production resources and secrets. Start with development only. Put local values in `apps/server/.env` and `apps/mobile/.env.local`; both are ignored by Git. Do not send secret values in chat. Railway will hold deployed server secrets; EAS will hold build credentials.

## Needed for the next slice: email OTP and the database

| Variable              | Where it comes from                                               | Purpose                                                                |
| --------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`        | Neon development branch, pooled URL for a restricted runtime role | API database access; no schema ownership, superuser or RLS bypass      |
| `DIRECT_DATABASE_URL` | Same Neon branch, direct URL for the migration role               | Prisma schema migrations; never distributed to the mobile app          |
| `BETTER_AUTH_SECRET`  | Generate locally using cryptographic randomness                   | Better Auth server secret; already generated in the local ignored file |
| `RESEND_API_KEY`      | Resend API keys; restrict to sending for the verified domain      | Deliver OTP messages from the server                                   |
| `EMAIL_FROM`          | An address under your verified domain                             | Initial selection: `Portl <auth@jacked.dev>`                           |

Database role provisioning and RLS will be implemented and verified with the database slice. A dashboard-provided owner connection must not become the production runtime connection. Do not run migrations against a production branch during local development.

If the restricted runtime role does not exist yet, fill `DIRECT_DATABASE_URL` first. We can provision that role during database setup and then populate `DATABASE_URL`.

Better Auth creates and verifies OTPs and establishes sessions. Resend delivers email through its API. There is no separate Better Auth SaaS API key, password-login credential or mailbox password. Add `jacked.dev` (or a dedicated sending subdomain) to Resend and publish its verification DNS records. Your Gmail address can receive test messages; it cannot be a Resend From address because you do not control `gmail.com`.

## Configuration we supply

`BETTER_AUTH_URL` is the backend base URL. `TRUSTED_ORIGINS` is the exact allowlist for auth requests, initially the `portl://` app scheme; local development and production allowlists will be separate. `EXPO_PUBLIC_API_URL` is the backend URL reachable from the device. None of these URLs is a secret. The current bootstrap reads only `NODE_ENV`, `HOST`, `PORT` and `LOG_LEVEL`; integration fields are reserved for the next slices and do not activate unfinished features.

For local URLs use `http://localhost:3000` on an iOS simulator, `http://10.0.2.2:3000` on the standard Android emulator, or the computer's LAN address on a physical device. Deployed URLs use HTTPS. Do not commit a development transport exception into release builds.

## Prepare later; not needed to start

| Integration            | Credentials / configuration                                                                                                                             | Storage                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Durable worker         | `WORKER_DATABASE_URL`, separately scoped role on the same Neon branch                                                                                   | Server/worker secret store                                                        |
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
