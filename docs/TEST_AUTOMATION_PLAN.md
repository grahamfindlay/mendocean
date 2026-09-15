# Test automation improvement plan

Approved plan, September 14, 2026. Implementation and verification are recorded in `TESTING.md`, `DEPLOYMENT_STATUS.md`, and pull request #2.

The objective is to replace most of the remaining manual technical checks with repeatable automation. Graham's pilot use should concentrate on accurate prefilling, understandable interactions, and fast logging. Completion means demonstrating the application working across its real internal services, with clear limits on what simulated providers and browser emulation establish.

## 1. Keep the current tools; connect the missing layers

Current coverage:

- Vitest covers application rules and client behavior. PGlite applies migrations and exercises PostgreSQL permissions and transactions, with a simplified Auth/Storage setup.
- Python tests cover training behavior.
- Playwright runs three scenarios in desktop Chromium and Chromium with phone emulation. Logging uses the development preview adapter; weather is intercepted. These are useful UI tests, not complete backend tests or actual iPhone tests.
- GitHub Actions runs these checks on pushes and pull requests. Backend functions are type-checked but are not exercised together through a full local Supabase stack.
- Login and a push notification have been confirmed by the owner on the deployed app. Scheduled reminder delivery and full BHC import behavior have not been established by those confirmations.

Use Playwright, Vitest, Deno tests, the Supabase CLI, and GitHub Actions. Keep the fast PGlite suite. Add a disposable local Supabase stack for Auth, PostgreSQL, PostgREST, Storage, and Edge Function integration. Use a small purpose-built provider fixture server and injectable delivery adapters; do not add MSW or Testcontainers unless a concrete implementation need emerges. Supabase already manages the required containers.

No additional hosted service or staging subscription is required for this phase. Full-stack checks can run on GitHub's Linux runners. Reproducing them on Graham's Mac requires a Docker-compatible runtime; its installation is separate from this plan. Measure CI duration and usage before increasing frequency.

## 2. Build a reproducible isolated test environment

Add a harness under `tests/support/` and `scripts/test-stack.*`, with a pinned Supabase CLI version and documented commands.

The harness will:

1. Create a temporary project directory with a unique test project ID and explicit local ports. Copy the application's migrations, function sources, templates, and generated local configuration into it.
2. Override production SMTP with local Mailpit, configure the local frontend origin, and generate disposable encryption, job, and VAPID secrets. Match production's invite-only Auth behavior. Never source `.env.local`, `.env.server.local`, or the repository's hosted-project linkage.
3. Start Supabase, apply every migration including storage constraints, serve functions, and wait for explicit readiness checks with deadlines.
4. Start provider fixtures accessible from the function containers. Generate the frontend environment using only the local URL and public key; build the production frontend and serve `dist` on a fixed test origin.
5. Seed synthetic users, practices, memberships, weather, and subscriptions with unique run/test identifiers. Create users through Auth's admin API; application tests then use ordinary user sessions.
6. Collect results and stop/remove only this test stack in a guaranteed cleanup step, including on failure.

Reject nonlocal Supabase targets for every seeding, reset, and destructive test command. Reject production hosts and credentials before starting. Do not copy user observations, real BHC tokens, email addresses, or push endpoints into fixtures. Use no production secrets in pull-request CI. Configure fixtures to fail unexpected external requests rather than silently contacting providers.

The current production Auth config contains Resend settings. The generated local config must be explicit and tested so no login test can send a real email. Do not modify hosted Auth settings while preparing the harness.

Acceptance: a clean CI runner can start, test, and destroy the environment using one command; repeating the run requires no manual database reset or account setup.

## 3. Introduce narrow backend test seams

Refactor the API and job dispatcher into exported request handlers with thin production `Deno.serve` entrypoints. Extract only the boundaries needed to control upstream BHC/weather requests, email/push delivery, and application time. Keep authentication, validation, job claiming, database writes, and authorization real in integration tests.

Production entrypoints supply the current real adapters. Test entrypoints, present only in the generated test project, supply fixture adapters. There must be no request parameter, public debug route, or production authentication bypass that enables test behavior. Preserve the BHC endpoint allowlist and subscription endpoint checks.

Use fixed clocks for fast rule and worker-logic tests. For tests exercising PostgreSQL `now()` and job reservations, create records relative to the actual database clock, set due/retry timestamps through local-only fixture helpers, and invoke the real dispatcher. Advancing Playwright's browser clock does not advance PostgreSQL or Edge Functions. Do not add a production clock-setting RPC.

The notification fixture records channel, recipient identity, payload, idempotency key/tag, and responses. It can simulate acceptance, definite failure, timeout after acceptance, and expired push subscriptions. Treat ambiguous delivery honestly: email idempotency and push tags reduce duplication but do not establish universal exactly-once display on devices.

Acceptance: real request handlers can be exercised without real provider credentials; production entrypoints retain their existing authorization boundaries and behavior.

## 4. Add backend integration scenarios first

Run these against the real local Supabase services. Use direct API/RPC requests for most cases rather than repeating every permutation through the browser. Use service credentials only for arranging fixtures and inspecting outcomes, never for the user action whose permissions are under test.

| Area | Required automated scenarios | Evidence checked |
| --- | --- | --- |
| Auth and access | Invited sign-in; anonymous and unapproved access rejected; public signup rejected; missing/invalid credentials; user B attempts to read, update, delete, and export user A's reports through API and exposed RPC/table routes | Actual response status/body plus unchanged protected records; no private fields in public responses |
| Reports | Official and independent rows; weather/non-weather cancellations; validation; editing/deleting; same submission retried; concurrent distinct edits; nonmember access | Stored values, exactly one report for retries, version conflict without lost data, membership enforcement |
| Shared practices | Two users import the same BHC practice and submit separately | One outing with separate reports; training export preserves grouping, and existing weighting tests establish total outing weight one |
| BHC import | Attending/declined/unknown; empty responses; repeated import; changed times; later occupied lineups; coaches; disconnect/reconnect; invalid token; malformed data; pagination/continuation; interrupted sync | Correct memberships and plans, no duplicates, authored reports unchanged, locks released, retries recorded, no secret-bearing logs |
| Reminders | End + 15-minute boundary; decline/unknown/paused/skipped/already-reported suppression; independent outing opt-in; reschedule; snooze generations; expiry; concurrent dispatch; provider failure and retry | Delivery attempts and reservations, selected channel, correct link/timing, suppression and retry state |
| Push | Registration; test request scoped to the user's saved endpoint; missing/wrong-account endpoint; 404/410 removal; no email fallback | Recipient isolation, safe errors, subscription cleanup, correct payload |
| Weather | Successful collection; upstream outage/malformed response; cached/stale/expired handling; historical enrichment | Forecast timestamps and response behavior, one immutable compressed archive per run, readable gzip, feature source provenance |
| Queue | Claim contention; retry backoff; expired jobs; worker time budget and releasing unfinished claims | No simultaneous duplicate claim, appropriate due times, terminal status, recoverable remaining work |

Exercise BHC sync scheduling around the reported attendance deadline, including Madison daylight-saving transitions. Test discovery of newly posted practices as well as updates to known ones; do not assume the daily discovery poll alone is the after-deadline refresh.

Use a matrix of inputs for reminder eligibility, then a smaller set of full worker tests to establish that the dispatcher and delivery reservations honor it. Inject failures at meaningful boundaries, including after a provider accepts a message but before the database records completion. Any uncovered product bug gets a focused fix and regression test, rather than weakening the expected result to match the implementation.

## 5. Add a small full-stack browser suite

Keep the existing preview tests, clearly named as preview/UI coverage. Add `tests/e2e/` with a separate Playwright config targeting the production build connected to local Supabase. The suite must fail if preview mode or intercepted application APIs are used. Verify the production service worker is installed and controlling the page before offline scenarios.

Required journeys:

1. Request a sign-in code for a synthetic invited account, read the matching message through Mailpit, enter the code, and reach the account page. Exercise an invalid code too. Other tests may reuse securely stored temporary sessions to avoid repeating this journey.
2. Open an imported practice, check its prefills, submit an observation, reload, edit it, and verify persistence through a fresh authorized API read.
3. Create an uncoached independent row and a weather cancellation. Assert stored values, not just success messages.
4. Save while offline, reconnect, and verify one upload. Separately persist a draft/queued report across browser restart using the same temporary browser profile. Verify successful page loading from the service worker cache while offline.
5. Switch between two accounts with pending drafts/reports and confirm separation. Create a conflicting edit in two sessions and verify the user's recovery path.
6. Save reminder preferences and confirm they persist. Verify the push setup/test UI using controlled browser capability responses where needed; label this as UI coverage rather than actual OS delivery.

Run core journeys in desktop Chromium and WebKit. Keep a clearly labeled mobile-emulation layout check. Run persistent-profile/offline restart scenarios in Chromium first; document exact coverage rather than equating WebKit with an installed iPhone PWA. Use browser state/assertions and bounded polling instead of arbitrary sleeps.

Acceptance: the browser writes data through normal Auth and API paths, reloads it successfully, and offline tests upload to the real local backend. Production preview flags cannot substitute for authentication. Failures retain useful traces/screenshots without committing sessions or tokens.

## 6. Make results dependable in CI and deployments

Split CI into a fast lane (current unit/PGlite/Python/build/type checks) and a full-stack lane (local Supabase integration and browser tests). Run both for pull requests and changes to the application, migrations, test harness, or workflows. Scope fixture data per test and keep destructive/clock-sensitive worker cases isolated from concurrently running tests.

Use bounded startup/test/job timeouts, cleanup on failure, and a concise summary grouped by scenario. Preserve redacted diagnostics and synthetic-data-only browser traces for seven days. Do not attach raw Auth headers, session files, OTPs, provider URLs containing tokens, or real-service responses. Fail repeated-test instability rather than relying on broad retries to turn intermittent failures green.

Before enabling the suite as a required release check, obtain three consecutive clean CI runs and measure duration. Target a full run under 15 minutes, but report measured timing rather than promising it. Retry infrastructure startup at most once with a clear classification; product assertion failures should remain visible.

The current Cloudflare production branch deploys automatically and is not gated by the CI result. During implementation, use a separate nonproduction branch. Release the verified changes through the existing deployment branch after checks pass. When moving production to `main`, make both test jobs required for merging and configure Pages to deploy only that protected branch. A required CI job alone does not gate direct pushes to an automatically deployed branch.

Proposed commands: `npm test` (fast suite), `npm run test:integration`, `npm run test:e2e:full`, and `npm run test:stack` (orchestrates the complete isolated run). Exact script names can be adjusted during implementation but must be documented in one place.

## 7. Add a small read-only production smoke suite

Create `tests/smoke/` and a separate workflow targeting `https://mendocean.fyi`. It must have no fixture creation/reset helpers or service-role key.

Check HTTPS and app loading, the intended deployment's build identifier, static assets/service-worker availability, public forecast rendering and response schema, useful future forecast coverage, forecast freshness, and rejection of unsigned account/report/job requests. Inspect public Auth settings for email enabled/signup disabled. Do not request sign-in codes, write reports, invoke the dispatcher, or send push/email messages in routine smoke runs.

Use a freshness threshold tied to the current 30-minute collection interval: fail the freshness check above 90 minutes, while separately verifying the app's configured stale/expired display rules in deterministic tests. Distinguish upstream data freshness failures from a broken page/API. Successful HTTP responses alone do not establish freshness.

Trigger after a confirmed successful Cloudflare deployment of the expected commit, using a GitHub deployment event if the integration emits a reliable one; otherwise use the release workflow to poll deployment completion with a deadline before starting smoke tests. Do not guess deployment completion by sleeping for a fixed duration. Provide a manual trigger and propose a twice-daily schedule at off-peak minutes. GitHub schedules require the workflow on the default branch; verify this when activating because production currently uses a feature branch. Scheduled Actions are periodic checks, not a minute-precise uptime SLA.

Use normal GitHub failure reporting and document where failures appear. Notification destinations/preferences and periodic activation are configured during implementation; this plan does not create a Codex automation or send messages. Keep routine success quiet.

Acceptance: smoke tests fail for a deliberately stale fixture and unauthorized-access regression in the isolated environment, then pass against the actual deployed site without modifying user data. Verify the failed-run reporting path with a controlled test, not by breaking production.

## 8. Retain explicit, limited live checks

Most provider edge cases belong in fixtures. Retain a read-only, manually invoked BHC contract check that validates response shape and import assumptions against an authorized real connection. It should expose only a redacted pass/fail summary, make bounded allowlisted reads, and never save raw payloads or the token as CI artifacts. Do not add the owner's token to ordinary CI. A passing contract check does not prove every lineup mapping is semantically correct; compare one real imported practice with BHC during acceptance.

Retain an actual scheduled reminder check on an opted-in real practice and a short device check for installed iPhone behavior, offline reopening, and notification links. The owner's desktop push success is already evidence; repeat it only when relevant behavior changes. Automated email capture establishes composition/login behavior, not inbox placement; simulated push establishes requests/payloads, not visible OS banners.

Record each outcome with date, environment, browser/device, and limitation in the pilot checklist. The target is a short acceptance session and normal practice use, not a recurring manual edge-case matrix.

## 9. Delivery order and completion criteria

Implement in this order: isolated harness → backend seams and API/privacy/report tests → BHC/reminder/weather integration → production-build browser journeys → CI reliability/release checks → read-only production smoke → residual live acceptance record.

Expected file groups include `tests/support/`, `tests/integration/`, `tests/e2e/`, `tests/smoke/`, separate Playwright configs, harness scripts, small backend handler/adapter refactors, `.github/workflows/ci.yml`, a smoke workflow, and updated `docs/PILOT.md`/`docs/DEPLOYMENT_STATUS.md`. Keep implementation changes tied to testability or failures actually discovered.

The improvement is complete when the priority scenarios above pass against a freshly created stack in three consecutive CI runs; the real backend is used by the browser suite; release checks and production smoke are demonstrated; failures provide actionable diagnostics; and the remaining real-device/provider checks are explicitly recorded rather than counted as automated coverage. Update the stale deployment notes to reflect the owner's successful push test.

Automating a synthetic backup/restore round trip can follow using the same isolated environment. Activating production backups, recovering a real encrypted backup, and activating model training remain separate pilot operations and are not made complete by this testing work. No learned model should be promoted as part of these tests.

## References

- [Supabase CLI and local/CI stack](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase testing and Mailpit](https://supabase.com/docs/guides/local-development/cli/testing-and-linting)
- [Playwright API testing](https://playwright.dev/docs/api-testing)
- [Playwright web-server setup](https://playwright.dev/docs/test-webserver)
- [Playwright authentication and session storage precautions](https://playwright.dev/docs/auth)
- [Playwright browser clock](https://playwright.dev/docs/clock)
- [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
