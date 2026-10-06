# Deployment status — September 14, 2026

The backend is deployed to Supabase project `exhoyifhvultmjryisce` in `us-west-2`.

Completed and verified:

- All 11 database migrations applied.
- `api` and `jobs` Edge Functions deployed with explicit dependency maps.
- Hosted Auth public signup disabled; both localhost development origins configured.
- Public browser key saved in ignored `.env.local`.
- BHC encryption key and job secret generated and installed as Edge Function secrets. The local recovery copy is ignored `.env.server.local` with owner-only file permissions. Move a recovery copy into the owner's password manager before pilot launch.
- Job secret and project URL stored in Vault; dispatcher scheduled every five minutes.
- Scheduled dispatcher HTTP response verified as 200, with a weather run and gzip archive object stored.
- Owner's administrator account created and approved without sending email.
- Real Open-Meteo collection completed and the public endpoint returned 192 hourly points.
- Unauthorized account/dispatcher requests and anonymous raw-table reads rejected.
- Production build, 41 fast TypeScript/PostgreSQL tests, 8 Python tests, and Edge Function type checks pass. CI also runs 6 preview browser cases, 23 real Supabase integration tests, and 25 production-build browser cases (plus 2 explicitly excluded persistent-profile variants).
- Frontend published at https://mendocean.fyi and live weather rendering verified. Pages is connected to `main`, which contains the merged pilot baseline. Preview branch deployments are disabled.
- Production origins and Auth site URL configured. Resend sending-only key, SMTP, and OTP template installed. Sender is `hello@mail.mendocean.fyi`. SMTP authentication succeeds and Resend has verified all four email DNS records.
- Owner confirmed receiving a sign-in code and successfully signing in. Owner also connected BHC and granted push permission; import results still need comparison with BHC.
- Web Push keys configured in Supabase and the frontend; the owner confirmed successful desktop push delivery on September 14.

The first hosted weather upload exposed an SDK behavior: uploading a Blob can send its own generic MIME type instead of the explicit gzip option. Uploading compressed ArrayBuffer bytes fixes this while preserving the archive bucket's gzip-only restriction. Worker errors now identify a safe, fixed weather stage without recording credentials or provider response bodies.

Not yet completed:

- Installed iPhone PWA behavior, if supported.
- One real BHC practice/lineup comparison and one opted-in scheduled reminder. Automated Auth/report/provider-edge-case coverage is described in `TESTING.md`.
- GitHub backup/training secrets, activation, and a restore drill.

No synthetic rowing observations were inserted into production. No learned model is active. The temporary Resend setup key was revoked and removed from the local setup file; production uses its separate sending-only key.

The custom domain uses Cloudflare DNS and HTTPS. The old `mendocean.pages.dev` address redirects in the browser to the new domain, preserving path, query, and fragment. No katahdin.me DNS changes are required.

Email-provider correction: hosted email login is enabled while global signup remains disabled. Verified public Auth settings and an actual rejected signup request (`422 signup_disabled`). The prior email-provider disablement caused the reported “Email logins are disabled” error.

## Test automation rollout

The Docker Desktop stack and read-only live API/Auth/browser smoke checks pass. The testing pull request is #2, targeting main. Required-check activation and the post-merge smoke result are recorded in the pull request and final delivery report; see `TESTING.md` for exact coverage and limits.

## Monitoring rollout — October 6, 2026

The monitoring changes were reconciled in an isolated checkout from current `main`, preserving the newer History, boat-selection and lake-camera UI and the original working directory.

Deployed and verified in Supabase project `exhoyifhvultmjryisce`:

- Additive migration `202610050001_monitoring.sql`; the dry run identified it as the only pending migration. Existing migration history was preserved.
- Compatible `api` and `jobs` functions with transactional activity, sanitized correlated diagnostics, dedicated readiness and owner-digest routes.
- Independent monitor/digest secrets, verified approved administrator recipient, and a successful live read-only digest preview. Recovery copies are in the owner's ignored `.env.monitoring.local` with mode 0600; move a copy to the password manager.
- GitHub digest/readiness credentials installed. Weekly digest enabled for Monday 8 AM America/Chicago. The client and server enforce the delivery window; first real acceptance/inbox receipt remains unverified. Preview does not send email.
- Authenticated readiness added to the existing twice-daily production smoke workflow. This provides a baseline; the planned five-minute Better Stack checks still require an account/token and alert-delivery verification.

[PR #72](https://github.com/grahamfindlay/mendocean/pull/72) merged after both required CI lanes passed. Cloudflare production serves commit `c15e857a495056f75d950ec06b4f4fd91b717afc`; exact-commit asset/auth checks and live browser rendering passed locally and in the GitHub production smoke workflow. The GitHub owner-digest workflow completed a live preview successfully, with no email sent. The frontend adds Account → Pilot administration → Activity and Operations, including the user timeline. Browser PostHog collection remains disabled. Cloudflare has the public production project token and US ingest host; the build deliberately requires a private upload credential before collection can be enabled. No public source maps are deployed.

PostHog plugin configuration is verified: **Mendocean** organization, US project [Mendocean production](https://us.posthog.com/project/648250), America/Chicago timezone and Monday week start. IP removal is enabled; replay, autocapture, automatic exceptions, console/performance capture, web vitals, surveys and heatmaps are disabled. [Mendocean beta usage](https://us.posthog.com/project/648250/dashboard/2175542) has five saved, owner-excluded insights and nonoverlapping layouts. All five queries executed successfully; empty results reflect preactivation. Supported measures use native queries; consecutive-week overlap uses a bounded custom query. No billing settings or notifications were changed.

Verified on the reconciled checkout: 105 unit/database tests, 49 real-backend integration tests, 79 preview browser cases, 49 production browser cases, 8 service-worker upgrade cases, 8 Python tests, TypeScript and Deno checks, a production build and zero audit vulnerabilities. Two preview, two production and two upgrade cases retain platform exclusions. Production tests include bundled SDK sanitation and blocked-provider behavior in Chromium, WebKit and mobile Chromium emulation. Email/provider fixtures do not establish production inbox placement or remote symbolication.

Remaining account steps are a project-restricted PostHog upload key (`error_tracking:write` and `organization:read`), optional server query-read key, billing-limit review, separate-project symbolication check, error-notification verification, and Better Stack monitor/incident/recovery setup. Details are in [MONITORING.md](MONITORING.md). Backup activation/restore drill and real-device push checks remain the separate historical tasks above.

## Monitoring activation — October 6, 2026

The user supplied scoped PostHog source-map and Better Stack team tokens in the ignored mode-0600 monitoring recovery file. The upload key is installed as a private Cloudflare production build variable. Real CLI uploads succeeded. A disposable local SDK fixture revealed that PostHog requires a frame `function` field; the adapter now supplies fixed `function: "?"` and `in_app: true` while continuing to strip raw names and private exception values. The corrected validation exception resolved to the original `src/main.tsx` line 5 with no processing errors, and its issue was marked resolved. Dashboard queries exclude the named setup validation builds.

Better Stack production monitors `5027624` and `5027625` are active and provider-verified healthy at five-minute intervals, with ten-minute failure confirmation and five-minute recovery confirmation. The sole team member is the account owner; `team_wait: 0` makes basic email escalation work despite the empty on-call schedule. The API rejected custom policy creation, so no plan was upgraded. Temporary validation monitor `5027626` opened incident `1027998970`, recorded an owner email sent, and resolved automatically after restoring the keyword. It is now paused. The owner confirmed incident inbox receipt; recovery email receipt remains unverified.

Activation requires merging the compatibility fix after both required CI lanes pass, enabling the Cloudflare production switch and rebuilding the same deployed commit. Error-notification destination configuration and optional digest analytics read credentials remain separate from the working app activity summary and weekly digest.
