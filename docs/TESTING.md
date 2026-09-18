# Automated testing

## Commands and coverage

| Command | What it verifies | Services |
| --- | --- | --- |
| `npm test` | Rules, client behavior, PGlite SQL permissions/transactions, smoke failure conditions | None |
| `npm run build` | Type checks and production compilation | None |
| `npm run test:e2e` | Existing preview UI scenarios | Development preview and synthetic weather |
| `npm run test:stack` | Fresh migrations, Auth, API, jobs, storage, upstream failures, then production-build browser journeys | Disposable local Supabase containers + fixture server |
| `npm run test:smoke` | Live public API, weather freshness, unsigned-access rejection, assets | Read-only production access |
| `npx playwright test --config playwright.smoke.config.ts` | Live forecast rendering and navigation | Read-only production browser |

Run `npm ci` first. The full stack requires a running Docker-compatible container runtime and Playwright browsers (`npx playwright install chromium webkit`; Linux CI uses `--with-deps`). No hosted Supabase credentials are needed. Use one full-stack run per host: ports 54321, 54322, 54324, 54328, and 4175 must be available. The harness uses a unique temporary project, and cleans up only its own containers/volumes on completion or interruption.

`test:integration` and `test:e2e:full` are child commands of the harness; they deliberately refuse to run without the local-only test environment. Do not configure them against a hosted project. The harness generates configuration in a temporary directory, ignores the owner's `.env` files, and captures Auth email in Mailpit. A local service-role key is used for fixtures and inspection; user actions use ordinary sessions. BHC, weather, Resend, and push responses are synthetic upstream adapters selected only by test composition roots. No request parameter can enable them in production.

The browser suite runs a production Vite build against the real local API. The `?preview=1` flag must not bypass authentication. Chromium and WebKit are desktop engines; the phone project is explicitly Chromium mobile emulation. Persistent-profile restart tests run in Chromium. Neither establishes installed iPhone PWA behavior or actual OS notification display.

## Failure interpretation

GitHub Actions has independent `fast` and `full-stack` jobs. Product assertion failures are not retried automatically. The harness prints stage names and redacts known secrets/JWTs from diagnostics. Full-stack traces and screenshots are disabled because they could contain session headers or sign-in codes; test names, assertions, and sanitized process output remain in Actions logs. Enable detailed local tracing only with synthetic accounts and do not upload raw session artifacts.

Smoke failures distinguish frontend availability, API availability, authorization regressions, and weather freshness. Weather older than 90 minutes is a smoke failure even if the API returns HTTP 200. Deterministic validator tests intentionally exercise stale forecasts and unexpected HTTP 200 responses on private endpoints; do not break production to test alarms.

`EXPECTED_SHA` makes the smoke command wait up to ten minutes for the exact deployed `build.json` commit before checking behavior. `SMOKE_PUBLIC_KEY` optionally overrides the public Supabase key for Auth-settings verification; it is not an administrator credential. The repository includes the same public anonymous key distributed with the frontend in `tests/smoke/public-config.json`; `SMOKE_PUBLIC_KEY` can override it. A missing key fails the check. No administrator credential is used.

Scheduled workflows run from GitHub's default branch, `main`. Pages now targets `main`. A push to main starts smoke with an exact build-identifier wait; this avoids depending on the Cloudflare deployment-event environment name. Both `fast` and `full-stack` are the required release checks. Activate protection only after three clean CI runs; verify activation in the release record.

## Limited live acceptance

- Owner confirmed successful login and desktop push delivery on September 14, 2026.
- Compare one real BHC practice and posted lineup against the app.
- Observe one opted-in scheduled reminder and its link during ordinary practice use.
- Check installed iPhone PWA reopening/offline behavior if that is a supported device.
- Optional read-only BHC contract check: `node scripts/bhc-contract.mjs`, with `BHC_CONTRACT_TOKEN` supplied through a protected process environment and `BHC_CONTRACT_CLUB_ID` only for accounts with multiple clubs. It makes at most five allowlisted reads and prints no provider payloads or tokens. Never add the owner's token to ordinary CI.

Backup activation/restore validation and learned-model activation are separate tasks; passing application tests does not establish either.

## Verified local coverage (September 14, 2026)

Docker Desktop on macOS: 23 real-backend integration tests and 25 production-build browser cases pass. Two persistent-profile variants are explicitly skipped because that scenario runs only in desktop Chromium. Browser execution took 34 seconds, excluding stack startup. The dispatcher budget test uses an injected monotonic elapsed clock in a test-only composition root; production has no clock override route. Shared-practice export grouping and malformed-weather cache preservation are exercised against real SQL/API handlers.

The suite found and fixes three application defects: database timestamp offsets rejected during edits/imported reports, pending offline reports hidden after a failed account refresh, and reminder preferences displaying loading defaults when Account opens before its fetch completes.

On macOS, if Docker Desktop installed its CLI under the user directory, run `PATH="$HOME/.docker/bin:$PATH" npm run test:stack`. The container fixture hostname uses Docker Desktop host networking; Linux CI uses its bridge gateway.

Smoke runs after pushes to `main`, waiting for the exact deployed build identifier, as well as on a twice-daily schedule and manual dispatch. Failed checks appear in the repository Actions tab and use the owner's existing GitHub Actions notification preferences; no separate notification subscription is created. Public API and Auth smoke passed locally against production; deployment activation is recorded in `DEPLOYMENT_STATUS.md`.

Three consecutive clean CI executions at `cc2f889` established repeatability: [push run](https://github.com/grahamfindlay/mendocean/actions/runs/34927422839), [PR run attempt 1](https://github.com/grahamfindlay/mendocean/actions/runs/34927424846/attempts/1), and [PR run attempt 2](https://github.com/grahamfindlay/mendocean/actions/runs/34927424846/attempts/2). Each passed both lanes, including all 23 integration and 25 browser cases. The first PR full-stack lane took 4 minutes 30 seconds, including installation/startup. Earlier assertion failures remain visible in Actions; no test-level retry masks them.

## Milestone 1 coverage (September 15, 2026)

The local suite passes 47 fast tests, 8 Python tests, 12 preview browser cases, 26 real-backend integration tests, and 31 production-build browser cases. Two persistent-profile variants remain intentionally excluded outside desktop Chromium. Added coverage exercises forecast timestamps, source bearings, supported model contexts, future/past outing actions, report filters, reminder authorization/state, and installed/uninstalled push guidance. Actual OS notification delivery still requires device acceptance.

Preview tests reserve port 4173 and fail if it is occupied; set `TEST_PREVIEW_PORT` to use another port (for example, `TEST_PREVIEW_PORT=4183 npm run test:e2e`). They never reuse an unrelated server. Preview and full-stack artifacts use separate `test-results/preview` and `test-results/full` directories. Offline restart failures emit sanitized startup diagnostics without session tokens.

## Milestone 2 coverage (September 16, 2026)

The local suite passes 52 fast tests, 8 Python tests, 14 preview browser cases, 27 real-backend integration tests and 34 production-build browser cases, with the same two deliberate persistent-profile exclusions. New coverage checks quarter-hour ingestion/archive/cache cadence, minute-specific windows and five-day comparisons, hourly fallback, rain interval/rate semantics, missing samples, DST/midnight, keyboard chart inspection and daily selection across Chromium/WebKit. See `PILOT_DESIGN_M2_DELIVERY.md` for resolution and interpolation policy.

## Milestone 3 coverage (September 16, 2026)

The suite passes 54 fast tests, 14 preview browser cases, 35 real-backend integration tests and 37 production-build browser cases, with the same two deliberate persistent-profile exclusions. New coverage exercises migration without extra opt-ins, independent channel choices, partial delivery, per-device push recovery, stable email retry payloads, channel quotas, leases, generation changes, preference changes and report suppression. Tests use synthetic email/push providers and do not send pilot notifications. See `PILOT_DESIGN_M3_DELIVERY.md` for retry guarantees and their limits.

## Milestone 4 coverage (September 16, 2026)

The suite passes 55 fast tests, 43 real-backend integration tests and 40 production-build browser cases, with the same two deliberate persistent-profile exclusions. Attendance changes use a synthetic BHC provider: successful and rejected writes, deadline changes, interrupted acceptance, failed readback, stale clients, replay/concurrency protection and reminder adjustments are covered. Real BHC contract verification is read-only by default. A production attendance write requires the owner's deliberate practice/status choice; see `PILOT_DESIGN_M4_DELIVERY.md`.

## Installed-app update regression (round 2, milestone 5)

`test:stack` also builds three distinct production releases and serves them successively from one local origin. `test:updates` is a harness-only child command; `npm run test:stack -- --updates-only` runs this focused lane with disposable Supabase services. CI runs the full harness, including upgrades.

Local results: 61 focused tests, 8 Python tests, 14 preview browser cases, 43 integration tests, 40 existing production browser cases and 14 upgrade cases pass. Each production browser lane has two documented exclusions. The upgrade lane also covers an online navigation from the legacy worker to the new release without an extra reload. Production smoke checks verify all deployed precache hashes and actual worker control, in addition to the existing public API checks.

These tests use actual service workers, Cache Storage and built JavaScript in Chromium and WebKit. External font requests are blocked in this lane to avoid relying on a third-party network connection during worker activation. Coverage includes foreground A→B→C updates, manual checks, two tabs with one unfinished draft, failed assets/worker requests, offline operation, an offline queued report, report edits and an attendance request held in flight. A Chromium persistent-profile case closes and reopens the browser, then reopens offline. Session setup occurs once, so a missing session after reload cannot be hidden by test reinjection. Registration reset methods are monitored during upgrades. Synthetic BHC connections remain in the real local database.

The fixture can return HTTP-200 HTML in place of a JavaScript file, modeling a CDN fallback; the worker must reject the incomplete release and retain its previous offline shell. Diagnostic `build.json` failure is tested separately: update eligibility depends on verified worker assets, not a metadata response. The fixture's release switch is authenticated, loopback-only, and excluded from production output.

This does **not** prove iOS suspension behavior or OS push-subscription continuity. Final acceptance requires the same installed iPhone app to receive a subsequent release without reinstalling, retain sign-in, recover a draft and reopen offline. An optional user-triggered push test checks actual delivery. No pilot account or actual attendance is changed by these tests.

The two WebKit exclusions in the update lane are offline navigation/activation and persistent-profile restart. Online A→B→C, failed downloads, two-tab coordination, report editing and in-flight attendance remain exercised in WebKit. `node tests/support/webkit-offline-probe.mjs` reproduces the macOS Playwright WebKit offline-navigation error using only a tiny cached HTML page and worker, with no Mendocean code or backend; the probe uses local port 4199. This limits the automation claim, not the product's intended offline support. Chromium covers the complete offline upgrade flow, and installed-iPhone acceptance remains pending.

## Readable weather regression (round 2, milestone 6)

The chart suite verifies that summary thinning leaves quarter-hour chart data intact, hourly rain chance uses the preceding-hour interval (including exact boundaries and missing/zero values), and Madison calendar days handle DST. Browser checks cover half-hour near-term/daily lists, 2–24-hour domains starting at actual now, keyboard and mouse inspection, domain freezing during gestures, gust overflow above the fixed 30 mph axis, and sized downwind vectors. A phone-only Chromium CDP touch case exercises horizontal scrubbing, pointer cancellation/restart and native vertical scrolling. That case is deliberately excluded from the desktop project; it does not establish physical iPhone behavior. See `PILOT_DESIGN_M6_DELIVERY.md` for scope and release verification.
