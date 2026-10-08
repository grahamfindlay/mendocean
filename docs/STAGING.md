# Hosted test deployments

## Current environment — October 7, 2026

The reusable staging environment has its own Supabase project (`zkuorkfrwxfnjfgjygah`, `mendocean-staging`, us-west-2) in the existing free organization. Production is `exhoyifhvultmjryisce` and is explicitly refused by mutating staging helpers. The live Pages site is [Mendocean Test](https://mendocean-staging.pages.dev), separate from the production `mendocean` Pages project. Provisioning, hosted validation and the requested physical iPhone release checks are complete. The owner confirmed the retests on October 7, 2026, against the deployed `2de5b1b` revision. Production remains unchanged.

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

Validation actions: `smoke` verifies hosted assets/precache hashes, closed signup, anonymous denial and actual authenticated fixture transitions with notification preferences off; `browser-smoke` checks the mobile hosted UI in Chromium and WebKit and saves ignored screenshots; `smtp-check` verifies TLS/SMTP authentication without sending; `email-check` sends one full-lineup email to the sole owner and restores the previous disabled notification preferences. Explicitly run `email-check` only when that test send is intended. Browser smoke uses a generated staging-only Auth session in memory and sends no login email. Run `smoke` and `browser-smoke` sequentially, and do not run either while another person is doing device checks: it changes the same fictional practice.

## Test controls and delivery

Account contains staging-only controls for Reset to unpublished, Publish lineup, Move my seat, Change my crew and Remove me from boat. They call a separate function which requires the exact staging backend URL, `STAGING_MODE=true`, and the sole configured owner's authenticated session. Dispatcher access has an independent random secret. These controls are absent from production builds; the staging function is not deployed by `deploy-backend` and is disabled unless both environment guards match.

The fictional practice uses reserved synthetic identifiers and names. Fixture SQL provides the connection/membership metadata required by the real lineup code, but no valid BHC token. The function calls the actual normalization/snapshot/event code. Its dedicated dispatcher uses actual email/push delivery helpers, leases, idempotency and per-device checkpoints. Only opted-in owner channels receive notifications. Jobs are delayed 30 seconds so the app can be closed, then delivered on the next minute tick. Do not trigger another scenario until the first delivery arrives: superseded pending alerts are intentionally cancelled. Reset followed by Publish creates another publication event. Seat, crew and removal actions now edit the current snapshot: a crew change preserves the rower's seat/side and other edits; repeated seat/crew actions toggle their own change. Publish restores the starting crew. Editing requires a published lineup, and seat/crew edits after removal require Publish to restore the assignment.

## iPhone checklist

1. Open the stable staging URL in Safari, add it to the Home Screen, and launch Mendocean Test.
2. Sign in with the invited owner's email and the emailed OTP. This is a separate account/session from production.
3. Enable push for this installation. Select and save lineup email/push preferences separately; logging reminders are independent.
4. In Account, Reset to unpublished, then Publish lineup. Close the app and wait up to 90 seconds. Tap the push: it must select the test practice, put your boat first and highlight You.
5. Repeat for a seat move, a crew change and removal. For another publication, Reset then Publish.
6. Open the email from Mail and check the full crew and exact practice link. Repeat after signing out to confirm the selected practice survives OTP sign-in.
7. Check background return, stale-data refresh, Focus/notification permissions and duplicate delivery. Mobile WebKit emulation is not physical-device confirmation.

## Physical device observations — October 7, 2026

The owner received push and email on a signed-in iPhone for publication, seat changes, crew changes and removal. The Mac email link prompted sign-in and then selected the correct lineup. iPhone push links selected the correct practice for republishing and all three edits; removal presentation looked correct. The initial publication push opened Forecasts/Today, so it was recorded as a routing failure. The owner subsequently confirmed the updated publication-routing retest passed.

Two issues were identified and corrected: explicit notification destinations now precede saved update-resume state, and the worker explicitly navigates a reused window and sends the destination to the running app. The cause of the first physical routing failure is not proven; regressions cover both known failure paths. Test crew changes previously rebuilt the default crew and undid a seat move; the controls now preserve the current assignment, and the owner confirmed the crew-only retest passed.

The iPhone Mail link opened Safari with a separate signed-out session. Safari OTP sign-in was blocked by staging's unchanged two-auth-emails-per-hour limit despite custom SMTP being configured. Staging now explicitly configures 30 sign-in emails/hour (read back and verified); no login email was sent to validate configuration. Keep the 60-second per-address send interval and closed signup. This Auth quota is separate from lineup notification delivery. See [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp) and [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

A Home Screen web app cannot reliably claim email HTTPS links as a native app does. Mail opening Safari is expected for the current app; its login session is separate. Use the full crew in the email, a push link, or open the Home Screen app and select Lineups. Native-app Universal Links require a signed app with Associated Domains entitlements and a website association file; see [Apple's associated domains documentation](https://developer.apple.com/documentation/xcode/supporting-associated-domains) and [WebKit's Mail navigation explanation](https://webkit.org/blog/7016/ios-10-link-preview-api-in-wkwebview/). No native wrapper was built or production settings changed.

The owner subsequently confirmed all requested retests worked: publication navigation from Forecasts after updating the installation; a crew-only change after moving seats; Safari/email OTP navigation; and push delivery/navigation after signing out of the Home Screen app. This completes the physical-device release gate for deployed revision `2de5b1b70ed241647691f8c15181ed3cb48ef6a1`. The Mail-to-Safari platform behavior remains as documented above. This confirmation is human physical-device evidence, separate from browser emulation.

## Findings during setup

- The organization is on the free plan and initially had one project; a second isolated project was created without a paid plan change.
- Supabase's Management API can return an empty body with a successful secrets update. The client must accept that instead of treating it as invalid JSON; rerunning configuration is safe.
- The CLI's linked database query reports the last result of multi-statement SQL. A trailing COMMIT can hide SELECT results. Use the dedicated read-only Management endpoint for observations and transaction batches for migrations.
- Wrangler's cached login is in `~/Library/Preferences/.wrangler/config/default.toml` on this Mac. Credentials stay out of output and source control.
- Wrangler's `pages project list --json` uses display labels such as `Project Name` as keys rather than `name`; the deployment identity check accepts both shapes.
- The pinned Wrangler dependency initially pulled a vulnerable `sharp`; the repository overrides it to a patched version. `npm audit` reported zero vulnerabilities after installation.
- Partial account creation can leave an Auth user before the fixture marker is installed. Setup looks up the matching staging email before creating a user, so a retry reuses the account and preserves notification preferences.

- Merging newer main exposed two migrations with version `202610070002`. Lineups now uses `202610070003`; staging migration setup relocates the exact original lineup history record without rerunning its SQL or changing data, then applies the new immediate-import migration. Duplicate versions and mismatched history names now stop deployment.

- Hosted checks share one fictional practice, so overlapping runs can invalidate their assertions. Supabase Auth cleanup defaults to global sign-out; the tools now explicitly sign out only their own session to preserve the owner's device session. Both smoke tools require notification preferences off before making fixture changes.

- Immediately after a Pages upload, the stable URL briefly served HTML and service-worker assets from different releases. Hosted smoke correctly refused the hash mismatch before touching fixtures. Allow the stable URL to settle, then rerun `smoke`; keep integrity checks strict. The final upload passed all nine hashes on retry and exposed matching HTML/worker build identities.

## Recorded validation

All repository unit/database checks passed (152 tests), including owner/service isolation, delayed staging claims, lock recovery and production-target refusal. The reconciled backend also passed 61 isolated integration tests. Type checks and a default production build passed; the production bundle excludes test controls. Hosted smoke validated all nine service-worker precache assets against their hashes, the staging manifest name and authentication settings, and unpublished/publication/seat/removal transitions without notification sends. The hosted mobile flow, test controls and reload passed in Chromium and WebKit, and the WebKit screenshot was inspected for layout. SMTP TLS/authentication passed. One full-lineup email was accepted by the real provider through the scheduled dispatcher; the owner confirmed inbox receipt on October 7, 2026. The owner also confirmed the physical iPhone release retests passed after the routing/scenario fixes. Test notification preferences were restored to off after the email check.

## Release and recovery

Staging testing does not merge the PR or enable production. The physical release gate is recorded as passed. The PR can proceed to review; production rollout remains a separate step. For rollout, deploy the same tested code/migrations and compatible functions to production, then enable its lineup flag. Keep the production target separate in every command. Roll back the staging frontend by republishing a previously tested build; retain additive database migrations. To stop test sends, unschedule `mendocean-staging-lineups` and disable `BHC_LINEUPS_ENABLED` in staging. Do not delete or rotate VAPID keys while checking an existing installation.

## Lineup presentation updates

The staging UI has one quiet Staging badge; practice/boat/crew names use Masters Recreational, River, and plausible fictional names. The Home Screen installation and sender retain the Mendocean Test identity so separate accounts remain distinguishable. Fixture practice times use 7:30–9:00 AM in America/Chicago. On upgrade, the old TEST practice is renamed and given a plausible future morning time.

To preview emails without sending, run `node scripts/preview-lineups.mjs` under Node 24. It writes publication, seat-change, crew-change and removal HTML/plain text plus a fictional lineup JSON to ignored `test-results/lineup-design/`. Set `LINEUP_PREVIEW_ORIGIN` to a running frontend origin; the default is `http://127.0.0.1:4173`. Serve the app on that port to load the email oar PNGs. Use these previews at phone and desktop widths before a deployment.

For presentation-only updates, deploy `api`/`jobs`, reinstall fixture helpers, deploy `staging-test`, then deploy the frontend. Run `npm run staging -- scenario refresh` to rename the saved fictional crew and add the fictional coach link without sending notifications or resetting the owner's seat/removal/publication state. This action intentionally skips notification delay/scheduling. Do not run hosted smoke/browser-smoke while the owner has notification preferences on; those checks change the shared fixture. Use `npm run staging -- assets` and local browser previews instead. The assets action verifies precache integrity, staging identity, closed signup and anonymous denial without creating an Auth session or changing fixtures. Keep existing VAPID keys and account preferences intact.

The presentation update was deployed to staging at revision `05dc58cfb966f268b9f99f54aff291ebca75e148` (build `05dc58cfb966f268b9f99f54aff291ebca75e148-8f612b6a`). Validation passed: 158 unit/database checks, 61 isolated backend checks, six lineup browser cases across desktop Chromium/mobile Chromium/mobile WebKit, and four email variants rendered at 390/640 pixels without overflow. Final visual inspection included the iPhone layout, publication email and removal email. Hosted verification matched all nine precache hashes, both hosted oar PNGs and the local staging build; closed signup and anonymous denial passed. Before/after reads confirmed identical crew assignments, publication state and notification preferences, with zero new notification events from the presentation refresh. No real email or login code was sent during these checks. Production remains unchanged.

The oar-layout follow-up corrects the fictional crew's standard sweep assignments: stroke/even seats port (right on the page), odd seats starboard (left). Real BHC lineups continue to use the provider's side assignments, including alternate rigs. `scenario refresh` also corrects the old fictional side assignments without sending notifications or moving any rower between seats. Crew-row spacing separates the seat/oar group from names, and app/email seat labels abbreviate Coxswain to Cox. Fifteen focused lineup/contact/scenario checks and six desktop/mobile browser cases passed; all four email variants rendered at phone/desktop widths without overflow, and corrected phone/email screenshots were inspected.

That correction is deployed to staging at `41818c5b7d3acbc73fd4614edc4f9cac6b24fb52` (build `41818c5b7d3acbc73fd4614edc4f9cac6b24fb52-f23e1db0`). Hosted precache/auth checks passed. Before/after reads confirmed preserved seat assignments, publication state and notification preferences, corrected fictional rowing sides, and zero new notification events.

A final spacing refinement moves each oar 3 CSS pixels inward toward its seat label, preserving the label/name column positions and the gap before rower names. HTML email cells apply the same 3-pixel inset without CSS transforms. Type checks and phone/desktop email rendering passed; this presentation-only deployment requires no fixture action or notification send.
