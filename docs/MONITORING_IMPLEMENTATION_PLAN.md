# Mendocean activity and monitoring implementation plan

Status: backend deployed, dashboard configured, weekly digest enabled; browser analytics and external incident alerts pending credentials. Created: October 5, 2026. Updated: October 6, 2026.

The browser adapter, transactional activity, owner view, readiness endpoint, provider setup scripts, digest and workflows are implemented. Backend deployment, the live digest preview and a healthy scheduled-dispatch baseline are verified. The PostHog dashboard is configured and its five queries execute. See [setup, privacy and recovery instructions](MONITORING.md) and [current deployment state](DEPLOYMENT_STATUS.md). Browser activation, live source-map verification, external alert delivery and first digest inbox receipt remain pending. Checked implementation items describe code and fixture verification.

Support the beta and the expected audience of about 65 users with PostHog for usage and browser errors, Supabase for application records and backend diagnostics, and Better Stack for external service checks. Extend the existing owner tools and provide one weekly digest. Keep external telemetry outside the critical path for signing in, reading forecasts, and saving reports.

## Recommended setup

| Component                    | Responsibility                                                                                         | Owner experience                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| PostHog Cloud                | Explicit usage events, identified user histories, browser exceptions, source maps                      | Usage dashboard and grouped errors            |
| Supabase                     | Confirmed report activity, observed account activity, sync and reminder state, structured backend logs | Expanded Account → Pilot administration       |
| Better Stack free monitoring | Frontend availability, backend readiness, optional backup heartbeat                                    | Email on sustained failure and recovery       |
| Weekly owner digest          | Application activity and outstanding problems                                                          | One email each Monday at 8 AM America/Chicago |

Use the US PostHog region to match the existing US deployment. Start with production telemetry only; local preview and automated tests use an inert or recording adapter. Leave session replay disabled initially. Enable it later for a specific debugging need after verifying masking and exclusions. Sentry, a second analytics product, a log drain, and a warehouse are outside this initial scope.

PostHog currently includes 1 million analytics events and 100,000 exceptions monthly. Better Stack's free offering includes 10 monitors and heartbeats. Start on free plans with no paid add-ons. If adding a PostHog payment method for advanced features, set each used product's billing limit to $0. Recheck allowances during setup. See [PostHog pricing](https://posthog.com/pricing) and [Better Stack pricing](https://betterstack.com/pricing).

## Existing foundations and gaps

- `src/Admin.tsx` already shows storage, failed jobs, weather freshness, and model review. `pilot_health()` also returns report counts, outing counts, and the oldest pending job, but the UI does not display all of them.
- Reports use transactional writes and submission IDs. `src/outbox.ts` stores reports locally and retries them, so a successful device save is different from server persistence.
- BHC connections retain sync timestamps and errors. Reminder deliveries track channels, generations, attempts, provider acceptance, and retries.
- `supabase/setup_cron.sql` dispatches every five minutes; weather is queued in 15-minute buckets. BHC has a daily refresh during the 16:00 Madison hour and additional practice-related jobs.
- Unexpected API errors become generic responses without structured diagnostics from the handler. Most job failures also retain generic text. A dispatcher can return HTTP 200 while individual jobs fail or retry.
- There is no general activity collection or browser error service. The generated Content Security Policy currently permits connections only to the app and Supabase.
- `vite.config.ts` generates a build ID, precache hashes, and a service-worker release manifest. Source-map tooling must respect this ordering.
- Existing production smoke checks run after releases and twice daily. Backup workflows exist, but `DEPLOYMENT_STATUS.md` records activation and restoration as outstanding; verify their current live state before claiming backup coverage.

## Data and identity rules

### Identity and activity

Identify signed-in PostHog users using their Supabase UUID. Resolve display names in the private admin view; do not send emails, display names, BHC identifiers, or report contents to PostHog. Anonymous forecast visits use the SDK's anonymous identity and remain separate from signed-in user counts.

Reset PostHog identity on sign-out and before switching accounts. Identify an existing session before recording its authenticated activity. Capture the actor when an operation starts, and do not attribute a late response from account A to account B. Token refreshes are not new sign-ins. References: [PostHog people](https://posthog.com/docs/data/persons) and [identity reset](https://posthog.com/docs/data/anonymous-vs-identified-events).

Add a small authenticated foreground observation request on launch and return to the visible app, throttled to once per 15 minutes per account. Validate identity on the server and timestamp receipt there. Name the resulting field **Last observed activity**: suspended devices, offline use, blockers, and missing observations prevent it from being an exact last-use time. It is independent of PostHog and does not run repeatedly while the app is hidden.

### Collection boundaries

Use a typed event and property allowlist. Disable DOM autocapture, automatic page views and page leaves, console capture, replay, surveys, and unrelated features. Send semantic screen names rather than raw URLs. Strip query strings, fragments, referrers, and unwanted SDK default properties before transmission; shared links can contain bearer tokens or record IDs.

Never capture passwords, email codes, BHC tokens or URLs, auth headers, push endpoints, form values, report notes, routes, coaching details, provider bodies, or network request/response bodies. Include a concise Account/help notice explaining activity and error collection. Keep the SDK's event filter and exception sanitizer covered by fixture tests containing these values.

All client telemetry is best effort. Missing configuration, blocked requests, provider outages, and telemetry adapter failures leave normal app behavior intact. Avoid adding a durable queue of sensitive browser diagnostics. Keep report recovery in its existing outbox.

### Application records

Add migrations for a private activity table, per-user observation summary, bounded operational events, and dispatcher completion state. Store fixed event names, timestamps, actor UUIDs, request IDs, and allowlisted metadata. Keep new tables inaccessible through ordinary table reads; expose limited service-only RPCs and enforce the existing administrator gate in the API.

Record report creation, edits, and deletion at the database mutation boundary. A replay of the same submission ID produces no additional activity event. Different edits count as edits, not new reports. Preserve this through duplicate submissions, uncertain HTTP outcomes, and offline retries. Exclude administrative reconciliation from user edit counts. New tables and summaries must also respect account deletion.

Keep detailed activity for 90 days and operational diagnostics for 30 days; retain small daily aggregate counts for one year for seasonal comparisons. Index by user/time and category/time. Add bounded daily cleanup using the existing dispatcher. Label metrics as beginning on the collection date rather than inventing historical usage.

## Initial events and measures

| Event or measure                    | Collection point                                        | Meaning                                                                    |
| ----------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `app_opened`                        | Visible launch or return after 30 minutes of inactivity | An observed visit, deduplicated across React effect replay                 |
| `view_opened`                       | Semantic destination change                             | Forecast Today, Week, Scheduled rows, My rows, Log, or Account             |
| `sign_in_completed`                 | Successful OTP verification                             | Explicit sign-in, excluding session restoration and refresh                |
| `report_started`                    | First meaningful interaction with the report form       | Intent to log, once per form session                                       |
| `report_queued`                     | Successful local outbox write                           | Saved on this device, still awaiting server confirmation                   |
| `report_upload_failed`              | Failed upload attempt                                   | Classified outcome; ordinary offline waiting is not a production exception |
| `report_save_confirmed`             | Confirmed server response                               | Client-observed completion, deduplicated by submission ID                  |
| Report created, edited, deleted     | Database transaction                                    | Authoritative application activity and digest counts                       |
| BHC and reminder preference changes | Confirmed application action                            | Setup/use outcome with fixed properties, without credentials               |

Attach only the event schema version, app build, semantic screen, signed-in state, online state, and bounded category properties. Use an opaque deduplication ID where needed. Do not record chart drag samples, clock ticks, weather refreshes, or every button click.

Create a PostHog dashboard with five views: weekly signed-in active users, users active in consecutive weeks, forecast use by destination, report-start to confirmed-save funnel, and exceptions by build/affected users. Show anonymous forecast activity separately and exclude owner activity by default. Browser completion events describe observed responses; database activity remains authoritative for saved reports.

## Milestone 1 Collect useful activity and browser errors

- [ ] Create the production PostHog project and add `posthog-js` behind a new `src/telemetry.ts` adapter. Add browser-safe project-token and region/host examples plus a telemetry enable switch.
- [x] Integrate identity lifecycle and explicit events in `src/App.tsx`, `src/Account.tsx`, `src/Logger.tsx`, and `src/outbox.ts`. Deduplicate initial effects and retries.
- [x] Add a React error boundary and sanitized exception capture for uncaught errors and selected caught failures. Keep validation errors, expected authorization failures, edit conflicts, and offline waiting out of production crash alerts.
- [x] Add a correlation ID to API requests/responses. Expose its response header through CORS. Include the ID in allowed client diagnostics so the owner can find the corresponding backend log.
- [x] Update `vite.config.ts` to allow only the selected PostHog ingest origin in `connect-src`. Prefer bundled SDK/error modules; verify any additional asset origin against actual production requests rather than broadening CSP by wildcard.
- [ ] Generate hidden source maps and upload them with a scoped build-only credential. Source-map processing that changes JS must finish before asset hashes and the service-worker manifest are finalized. Remove map files before deployment and verify that final assets still match the manifest. Do not put the upload credential in any `VITE_` variable.
- [ ] Configure grouped production error notifications to the owner and the five usage views. Disable unrelated default subscriptions.

Acceptance: a synthetic error in a controlled test project resolves to its original TypeScript line and build; sensitive fixtures never appear in telemetry; account switching preserves identity boundaries; PostHog failure does not affect sign-in, report saves, or offline updates. Do not add a public crash-test button.

## Milestone 2 Record application activity and backend failures

- [x] Add the private records and foreground observation endpoint described above, with server-side throttling and allowlisted inputs.
- [x] Extend report RPCs for atomic, deduplicated activity. Capture other confirmed changes where existing request IDs or canonical state transitions provide a reliable boundary.
- [x] Add `supabase/functions/_shared/observability.ts` for structured JSON logs. Record fixed operation/stage codes, severity, request ID, safe actor identity, duration, and outcome. Preserve safe weather-stage diagnostics and add equivalent BHC and reminder categories.
- [x] Log unexpected API/dispatcher failures without raw exceptions, SQL parameters, upstream URLs, or provider bodies. Persist bounded operational categories when the database is available; retain console diagnostics as a fallback when recording itself fails.
- [x] Record dispatcher start/completion and recent job outcomes. Completion means the dispatch loop finished and saved its dispositions, not that every claimed job succeeded. Training/export requests must not advance the tick timestamp.
- [x] Define activity summaries, recent error counts, and queue state in shared read-only RPCs. Use those same definitions in admin views, readiness, and the digest.

Acceptance: unauthenticated users and ordinary members cannot read activity for other users; replayed submissions and concurrent edits produce correct counts; DB failure still yields a safe diagnostic; cancelled, expired, and future jobs do not become overdue failures. Supabase's hosted logs remain the detailed investigation surface. [Supabase logging reference](https://supabase.com/docs/guides/observability/logs).

## Milestone 3 Extend the existing owner view

- [x] Add Activity and Operations sections to `src/Admin.tsx`, keeping reconciliation and model controls intact. Use administrator-only `admin/activity` and `admin/operations` routes; keep the existing `health` route private.
- [x] Show invited/approved users, first observed activity, last observed activity, current report count, reports created in the selected period, last report time, BHC connection/sync state, reminder preferences, and recent problem indicators.
- [x] Add a paginated user timeline of server-observed activity, confirmed report changes, and operational outcomes. Exclude report contents and credentials. Link to PostHog's user history using the shared UUID and owner-accessible provider views.
- [x] Show weather age, last completed dispatch, overdue pending/running jobs, recent retries/terminal failures, channel delivery failures, storage, and existing model status. Separate old failures from current incidents.
- [x] Provide 7-day and 30-day summaries, counts alongside percentages, a last-refreshed time, and manual refresh. Show loading/failure/empty states without presenting missing data as zero.

Acceptance: the owner can answer who is using the app, who has contributed reports, and who is experiencing a sync/delivery problem from the existing Account screen. Members cannot access these routes directly. The timeline is an observed activity history, not a complete click recording.

## Milestone 4 Monitor service health externally

Use Better Stack as the proposed provider. Configure five-minute polling where supported and confirm the exact free-plan options during setup. Send notifications only for failures that survive a confirmation interval, and send one recovery notice.

- [ ] Monitor `https://mendocean.fyi/` for HTTP success and expected page identity. Keep existing scheduled/release browser smoke checks for rendering, assets, authorization boundaries, and service-worker integrity; an HTML check alone does not prove those work.
- [x] Add `GET monitor/ready`, authenticated with a dedicated read-only monitor secret. Use a new service-only readiness RPC. Return 200 when ready, 503 when unhealthy, and 401 for missing/wrong credentials. Return a fixed status and safe reason codes only, with `Cache-Control: no-store`.
- [ ] Give Better Stack only this secret and any browser-safe gateway key required by hosted Supabase. Never provide the service-role key, `JOBS_SECRET`, a user session, or credentials in a query string. Verify the hosted gateway accepts the request headers.
- [x] Evaluate readiness against the following proposed starting thresholds. Record thresholds centrally and review noise after two weeks.

| Condition                                  | Initial threshold                                            | Response                                                         |
| ------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Frontend or readiness endpoint unreachable | Two consecutive failed checks                                | Owner incident and recovery notification                         |
| Database unavailable                       | Readiness query fails or times out                           | Readiness fails                                                  |
| Weather absent or stale                    | Latest successful collection older than 45 minutes           | Readiness fails, before the app's existing expiry boundary       |
| Dispatcher stalled                         | No completed tick for 15 minutes                             | Readiness fails                                                  |
| Queue not progressing                      | Active eligible job overdue/running beyond 15 minutes        | Readiness fails; account for leases, retry due times, and expiry |
| Unexpected API failures                    | At least 5 failures affecting at least 2 users in 15 minutes | Readiness fails; exclude validation/auth/conflict outcomes       |
| Individual BHC or reminder problem         | Failed/revoked sync or terminal channel failure              | User indicator and digest; widespread failures escalate          |
| BHC freshness                              | Beyond the next expected refresh plus a grace period         | Warning; use its daily/practice schedule, not weather's cadence  |

These thresholds are proposals, and external confirmation adds detection delay. One isolated transient retry should not create an owner incident. New persistent frontend issues remain PostHog notifications; group repeated occurrences rather than emailing for each error.

- [ ] When backups are confirmed active, add a success heartbeat only after encrypted artifacts are uploaded. Start with a 24-hour expectation plus a 3-hour grace period. Failed/skipped workflows must not ping success. Treat a restore drill as a separate acceptance item.
- [ ] Verify outage and recovery notifications using isolated fixtures and a test monitor. Never stop production Cron or deliberately make production weather stale to test alerts.

References: [Better Stack monitor configuration](https://betterstack.com/docs/uptime/api/create-a-new-monitor/) and [existing production checks](TESTING.md).

## Milestone 5 Add one weekly owner digest

Use a small GitHub Actions workflow and script, keeping execution independent of Supabase Cron. The proposed delivery time is Monday at 8 AM America/Chicago. GitHub's UTC schedule needs a local-time guard for daylight saving time and an idempotent weekly key; delivery is best effort near that time, not an exact-time guarantee.

- [x] Add an owner-summary RPC, an authenticated server delivery action, `scripts/owner-digest.mjs`, and a workflow with a manual preview mode. Obtain the recipient from explicit server configuration and restrict it to the verified owner; never accept arbitrary recipients from the request.
- [x] Reuse the application summary definitions from Milestone 2. Cover the previous completed Monday–Sunday local week and compare against its predecessor.
- [x] Include observed active/returning users, confirmed new reports and distinct contributors, edits/deletions separately, newly connected accounts, and unresolved weather/queue/BHC/reminder problems. Label account activity as observed. Avoid calling a report count divided by all practices a completion rate.
- [x] Add aggregate PostHog forecast usage and frontend error counts using a narrowly scoped read credential held only on the server. Use read-only bounded queries. If PostHog is unavailable, send the application summary and label that section unavailable rather than showing zero or suppressing the whole digest.
- [ ] Persist the weekly delivery key and fixed retry content, use Resend idempotency, and limit retries to its supported idempotency window. Give owner mail its own small quota while preserving the existing reminder budget and room for Auth email. Verify actual provider allowance before enabling delivery.
- [ ] Preview with fixture data, then send one explicitly requested owner test during implementation. Configure one weekly report and avoid adding a second overlapping PostHog digest subscription.

The digest links to the admin view, PostHog, and current incidents. It contains counts and concise problem summaries, not report text or private rowing details. It remains useful during ordinary rowing season; reduce to monthly or pause usage mail later if it stops informing decisions. Immediate incident alerts remain enabled.

## Validation and rollout

Implement each milestone as a reviewable change. Milestone 1 and Milestone 2 can be developed independently, but validate their identity and correlation contract together. Milestone 3 follows the application records; Milestone 4 follows the health records; Milestone 5 follows the shared summaries and established error collection.

1. Run meaningful unit tests for event sanitation, identity transitions, report deduplication, summary time windows, and threshold boundaries. Use the injected provider clock for backend checks and cover daylight-saving changes.
2. Extend PGlite and disposable Supabase tests for RPC permissions, transactional activity, queue/heartbeat behavior, readiness statuses, and digest retry limits. Do not direct integration fixtures at hosted production.
3. Run production-build browser journeys for sign-in, account switching, offline save/retry, expired sessions, blocked telemetry, and existing PWA updates. Test both Chromium and WebKit; use a real installed iPhone for any device-specific claims.
4. Run `npm test`, `npm run build`, Edge Function type checks, and `npm run test:stack` for the combined release. Extend smoke checks for the new authorization boundary and final asset hashes without sending real emails or exposing monitor credentials.
5. Deploy schema first, then backward-compatible backend functions, then frontend/build configuration. Existing installed clients must continue working. Keep telemetry disabled until the production token, CSP, sanitation, and source maps are ready.
6. Enable telemetry for the owner, then the beta users. Confirm one real report/outbox retry, one real BHC sync, and reminder provider acceptance. Provider acceptance does not establish inbox placement or notification display; retain the existing live reminder checks.
7. Enable the external monitors after the baseline is healthy, then preview and enable the owner digest. Review event volume, affected-user attribution, and alert noise after one week and again after two weeks before the 65-user rollout.

Add deployment/runbook details to `docs/DEPLOYMENT.md` and live verification evidence to `docs/DEPLOYMENT_STATUS.md` as milestones ship. Do not rewrite historical deployment assertions during planning.

## Setup and recovery

Implementation needs access to the PostHog project and Better Stack account, a confirmed owner recipient, and permission to configure deployment variables and monitoring notifications. The proposed defaults above avoid blocking code preparation on these details.

Browser configuration contains only the public PostHog project token, selected ingest host, and telemetry enable setting. Separate secrets cover source-map upload, aggregate analytics reads, monitor access, owner digest delivery, and the optional backup heartbeat. Use scoped credentials, existing secret stores, and examples with empty values; no real credentials belong in this document or repository.

Turning off the telemetry enable switch must restore a no-op adapter without changing report persistence or installed-app storage. Pause monitor/digest notifications during deliberate maintenance, recording the expected end. Revert UI/backend releases as needed while leaving additive schema compatible with earlier clients. Record credential rotation and a failed-provider recovery procedure in the runbook.

## Completion checklist

- [ ] Owner can inspect activity and application problems without reading raw private reports.
- [ ] Browser errors identify the correct build and source line; backend failures can be found by request ID.
- [x] Offline retries do not inflate authoritative report counts.
- [ ] Weather/dispatcher failures are detected even while the frontend returns HTTP 200.
- [ ] Test incident and recovery notifications reach the owner.
- [x] One weekly digest is verified with fixture counts and correct local week boundaries.
- [x] Telemetry contains no credentials or private form/report data, and failures do not block app use.
- [ ] Measured usage fits the selected free allowances, with paid usage disabled.
- [x] Deployment, maintenance, credential rotation, and rollback instructions are recorded.
