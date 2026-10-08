# Hosted test deployments

## Current environment — October 7, 2026

The reusable staging environment has its own Supabase project (`zkuorkfrwxfnjfgjygah`, `mendocean-staging`, us-west-2) in the existing free organization. Production is `exhoyifhvultmjryisce` and is explicitly refused by mutating staging helpers. The live Pages site is [Mendocean Test](https://mendocean-staging.pages.dev), separate from the production `mendocean` Pages project. Provisioning and hosted validation are complete; physical iPhone testing remains pending.

Non-secret identities live in `staging.config.json`. New database, BHC-encryption, dispatcher and VAPID secrets are saved in ignored `.env.staging.local`, with mode 0600. Move a recovery copy into the owner's password manager before removing or archiving this worktree; ignored files are not preserved by Git. The existing verified Resend sender and sending-only key are reused for Auth and test notification delivery. Test Auth identifies itself as Mendocean Test. No production accounts, reports, crew payloads or BHC tokens are copied. The sole owner's login email is looked up read-only in production and a separate approved staging account is created without an invitation email.

## Repeatable tools

Install with `npm ci` (Node 24), then use `npm run staging -- ACTION` or `node scripts/staging.mjs ACTION`. The repository pins Supabase and Wrangler. Supabase Management API access uses `SUPABASE_ACCESS_TOKEN`, or the existing macOS Supabase CLI Keychain credential. Cloudflare uses Wrangler's existing login; `CLOUDFLARE_ACCOUNT_ID` is set explicitly from the tracked config.

Actions, in order:

1. `init`: reuse the matching staging project or create it on the existing free organization; generate recovery secrets before creation. Refuses automatic provisioning on a paid organization. Never upgrades a plan.
2. `status`: confirm the target is `ACTIVE_HEALTHY` before proceeding.
3. `migrate`: apply missing repository migrations transactionally with matching `supabase_migrations.schema_migrations` history. Each application is recorded. This uses the Management API and never relinks the production checkout or puts a database password in process arguments.
4. `configure`: install staging secrets, exact-origin CORS, disabled public signup, email OTP templates and verified SMTP. Source sending settings from `STAGING_SENDER_ENV` or the existing ignored owner recovery file. Preserve existing generated staging keys.
5. `deploy-backend`: deploy compatible `api` and `jobs` functions to the explicit staging project.
6. `fixtures`: create/reuse the sole test owner and install `scripts/staging/fixtures.sql`. These helpers are deliberately outside production migrations and are service-role only.
7. `deploy-tests`: deploy the staging-only `staging-test` function with an explicit import map.
8. `scenario reset`: establish an unpublished fictional practice without sending a notification.
9. `scenario weather`: collect a real public weather forecast into staging.
10. `schedule`: schedule staging-only delivery each minute and weather collection every 15 minutes. Do not install `supabase/setup_cron.sql` in this fixture environment: that dispatcher would try to import synthetic BHC credentials.
11. `deploy-frontend`: build against staging public keys with telemetry disabled, label the website/manifest Mendocean Test, and publish the `staging` branch to the separate Pages project.

Run later deployments with `migrate`, `deploy-backend`, `fixtures`, `deploy-tests`, and `deploy-frontend`. Configuration changes require `configure`; this reuses existing VAPID keys so registrations continue working. Reinstalling fixture helpers must preserve the owner and preferences. Build variables explicitly override any production `.env.local`; only public staging keys are bundled.

Validation actions: `smoke` verifies hosted assets/precache hashes, closed signup, anonymous denial and actual authenticated fixture transitions with notification preferences off; `browser-smoke` checks the mobile hosted UI in Chromium and WebKit and saves ignored screenshots; `smtp-check` verifies TLS/SMTP authentication without sending; `email-check` sends one full-lineup email to the sole owner and restores the previous disabled notification preferences. Explicitly run `email-check` only when that test send is intended. Browser smoke uses a generated staging-only Auth session in memory and sends no login email. Do not run scenario smoke while another person is doing device checks: it changes the same fictional practice.

## Test controls and delivery

Account contains staging-only controls for Reset to unpublished, Publish test lineup, Move my seat, Change my crew and Remove me from boat. They call a separate function which requires the exact staging backend URL, `STAGING_MODE=true`, and the sole configured owner's authenticated session. Dispatcher access has an independent random secret. These controls are absent from production builds; the staging function is not deployed by `deploy-backend` and is disabled unless both environment guards match.

The fictional practice uses reserved synthetic identifiers and names. Fixture SQL provides the connection/membership metadata required by the real lineup code, but no valid BHC token. The function calls the actual normalization/snapshot/event code. Its dedicated dispatcher uses actual email/push delivery helpers, leases, idempotency and per-device checkpoints. Only opted-in owner channels receive notifications. Jobs are delayed 30 seconds so the app can be closed, then delivered on the next minute tick. Do not trigger another scenario until the first delivery arrives: superseded pending alerts are intentionally cancelled. Reset followed by Publish creates another publication event.

## iPhone checklist

1. Open the stable staging URL in Safari, add it to the Home Screen, and launch Mendocean Test.
2. Sign in with the invited owner's email and the emailed OTP. This is a separate account/session from production.
3. Enable push for this installation. Select and save lineup email/push preferences separately; logging reminders are independent.
4. In Account, Reset to unpublished, then Publish test lineup. Close the app and wait up to 90 seconds. Tap the push: it must select the test practice, put your boat first and highlight You.
5. Repeat for a seat move, a crew change and removal. For another publication, Reset then Publish.
6. Open the email from Mail and check the full crew and exact practice link. Repeat after signing out to confirm the selected practice survives OTP sign-in.
7. Check background return, stale-data refresh, Focus/notification permissions and duplicate delivery. Mobile WebKit emulation is not physical-device confirmation.

## Findings during setup

- The organization is on the free plan and initially had one project; a second isolated project was created without a paid plan change.
- Supabase's Management API can return an empty body with a successful secrets update. The client must accept that instead of treating it as invalid JSON; rerunning configuration is safe.
- The CLI's linked database query reports the last result of multi-statement SQL. A trailing COMMIT can hide SELECT results. Use the dedicated read-only Management endpoint for observations and transaction batches for migrations.
- Wrangler's cached login is in `~/Library/Preferences/.wrangler/config/default.toml` on this Mac. Credentials stay out of output and source control.
- Wrangler's `pages project list --json` uses display labels such as `Project Name` as keys rather than `name`; the deployment identity check accepts both shapes.
- The pinned Wrangler dependency initially pulled a vulnerable `sharp`; the repository overrides it to a patched version. `npm audit` reported zero vulnerabilities after installation.
- Partial account creation can leave an Auth user before the fixture marker is installed. Setup looks up the matching staging email before creating a user, so a retry reuses the account and preserves notification preferences.

## Recorded validation

All repository unit/database checks passed (142 tests), including owner/service isolation, delayed staging claims, lock recovery and production-target refusal. Type checks and a default production build passed; the production bundle excludes test controls. Hosted smoke validated all nine service-worker precache assets against their hashes, the staging manifest name and authentication settings, and unpublished/publication/seat/removal transitions without notification sends. The hosted mobile flow, test controls and reload passed in Chromium and WebKit, and the WebKit screenshot was inspected for layout. SMTP TLS/authentication passed. One full-lineup email was accepted by the real provider through the scheduled dispatcher; inbox receipt and physical iPhone push/link behavior require the owner's confirmation. Test notification preferences were restored to off after the email check.

## Release and recovery

Staging testing does not merge the PR or enable production. After the physical checklist is recorded as passing, deploy the same tested code/migrations and compatible functions to production, then enable its lineup flag. Keep the production target separate in every command. Roll back the staging frontend by republishing a previously tested build; retain additive database migrations. To stop test sends, unschedule `mendocean-staging-lineups` and disable `BHC_LINEUPS_ENABLED` in staging. Do not delete or rotate VAPID keys while checking an existing installation.
