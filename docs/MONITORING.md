# Monitoring operations

Backend monitoring is deployed, the PostHog dashboard is configured, and the Monday owner digest is enabled. Both five-minute Better Stack production monitors are active and healthy. PostHog source-map credentials and real symbolication are verified; the production build switch `VITE_TELEMETRY_ENABLED` controls browser collection. See [deployment status](DEPLOYMENT_STATUS.md) for verified state and validation limits.

## What is collected

Administration at `/admin` has separate Accounts & activity and Operations pages. Accounts & activity shows observed users, report contributions, BHC status, reminder problems and a paginated history, and provides pilot invitations. Supabase records report changes inside the same transaction as the report. Replayed submission IDs do not create extra records. Foreground observations are throttled for 15 minutes on the server. Background syncs and failures do not make users appear active. Owner activity is excluded from summary usage counts.

PostHog receives explicit semantic events and sanitized exceptions through `src/telemetry.ts`. Identity uses the Supabase UUID. The adapter resets identity at initialization, account switches and sign-out. Events allow only fixed categories, screen, build, schema version, booleans, opaque IDs and the configured public ingest token required by PostHog. Top-level person metadata is stripped too. Exception messages are fixed; frames retain app bundle positions and source-map chunk IDs while dropping raw messages, variables, context and provider URLs. Frames include a fixed `function: "?"` and `in_app: true` so PostHog can parse them without receiving raw function names. Autocapture, replay, page URL collection, campaign/referrer persistence, surveys, automatic exceptions, feature flags and geolocation enrichment are disabled. Telemetry failures do not gate the app. Confirmed upload events use bounded local deduplication across reloads; database records remain authoritative.

Supabase's private tables hold the user mapping and authoritative outcomes. Detailed backend investigation stays in Supabase Logs Explorer. Unexpected failures produce fixed structured JSON with operation, request ID, actor UUID, severity, outcome and duration. Job logs include a job ID and fixed stage. Do not paste report bodies, credentials or raw upstream exceptions into logs. Expected validation, authorization and edit conflicts are excluded from failure incidents.

Detailed activity is retained 90 days, operational events 30 days, daily aggregate counts 366 days and owner digest records 90 days. Cleanup runs with dispatch completion, in bounded batches for detailed records. Account deletion removes associated activity and anonymizes operational actor references. Existing application data and hosted Supabase logs retain their existing lifecycle; these limits do not change provider retention. Review PostHog retention and deletion separately when activating it.

## Activate PostHog

The PostHog plugin is connected to the **Mendocean** organization on US Cloud. Its unused default project was renamed [Mendocean production](https://us.posthog.com/project/648250) (project ID `648250`) on October 5, 2026. Verified settings: America/Chicago timezone, Monday week start, `https://mendocean.fyi` app origin, IP removal enabled, and autocapture, automatic exceptions, replay, console/performance capture, web vitals, surveys and heatmaps disabled. Controlled setup validation events have been ingested; the production collection switch is `VITE_TELEMETRY_ENABLED`. [Mendocean beta usage](https://us.posthog.com/project/648250/dashboard/2175542) contains five owner-excluded insights, with all queries and layouts verified.

1. Use this existing production project. Keep local/preview traffic in a separate project. Verify billing limits and disable paid usage before enabling collection; billing access is not included in the current plugin connection.
2. Set Cloudflare production build variables from `.env.example`: `VITE_POSTHOG_TOKEN` (public project token), `VITE_POSTHOG_HOST` (US or EU ingest origin) and eventually `VITE_TELEMETRY_ENABLED=true`.
3. Store build-only `POSTHOG_CLI_API_KEY`, `POSTHOG_CLI_PROJECT_ID` and `POSTHOG_CLI_HOST` in the deployment secret store. Use a separate project-restricted personal API key with `error_tracking:write` and `organization:read`, as required by the [source-map CLI](https://posthog.com/docs/error-tracking/upload-source-maps/cli). Do not prefix these with `VITE_`. The app cannot enable telemetry successfully without source-map build credentials. Region mismatch or CLI failure stops the build. Dry runs are accepted only in the isolated test harness.
4. Generate the five dashboard definitions with `scripts/setup-posthog.mjs`. Configure `POSTHOG_PROJECT_ID`, `POSTHOG_API_HOST`, comma-separated `POSTHOG_OWNER_IDS` and a temporary setup key with dashboard/insight read/write and query read access. Run without `--apply` to preview, then run with `--apply`. It validates queries before mutations and reuses named dashboards/insights. Revoke the setup key afterward. The dashboard contains weekly users, consecutive-week users, destination use, a report funnel and errors by build. Anonymous forecast views appear separately. Native funnel results are observed user conversion, not an authoritative report completion rate. Weekly usage, destination counts and errors use native trends; only consecutive-week overlap uses custom SQL.
5. Configure one grouped owner notification for new/persistent production errors in PostHog. Verify receipt in a test project and remove default or duplicate subscriptions. No real notification has been sent by this implementation.
6. Verify a controlled test exception in a separate project resolves to the original TypeScript line and release. Local fixtures cover sanitation and bundle positions. A disposable local SDK fixture using the production project verified remote symbolication on October 6, 2026; setup builds are excluded from dashboard usage and the validation issue is resolved. Then enable the production flag and inspect one normal owner session before inviting beta users.

Vite uploads and processes maps before computing the service-worker asset hashes. All `.map` files are removed from the deployment. CSP admits only the chosen ingest origin; SDK and error modules are bundled. Rebuild with telemetry disabled to stop browser collection while keeping application activity available.

## Deploy application monitoring

Schema precedes functions; functions precede the frontend. Keep existing clients compatible. Generate independent random `MONITOR_SECRET` and `OWNER_DIGEST_SECRET` values (at least 32 random bytes), keep recovery copies in the owner's password manager, and install them through Supabase secrets. Neither belongs in a browser build, public URL, document or Git.

```sh
supabase db push --dry-run
supabase db push
supabase functions deploy api --no-verify-jwt
supabase functions deploy jobs --no-verify-jwt
```

The rollout was reconciled in an isolated managed checkout from current remote main, preserving the original local changes. The missing `202609200002_admin_model_health.sql` was recovered unchanged from remote Git; it was already applied in production. Do not mark that migration reverted or change production history to accommodate an outdated checkout.

Backend monitoring does not require the PostHog flag. Open Administration → Accounts & activity or Operations as an approved administrator, using the header link or `/admin`. Confirm members receive 403 for `admin/activity`, `admin/operations` and `admin/timeline`; anonymous requests receive 401. Verify a normal report retry leaves one authoritative created event and that BHC/reminder outcomes appear without private contents. The existing public weather route remains public.

## External service monitor

The private `GET /functions/v1/api/monitor/ready` accepts only `Authorization: Bearer <MONITOR_SECRET>` (plus the public Supabase gateway key where required). It returns fixed reasons and 200/503, without user information. It has no authority to run jobs, send a digest or read admin data.

Readiness fails when weather is absent/over 45 minutes old, dispatch completion is absent/over 15 minutes old, an unexpired eligible pending/running job is over 15 minutes overdue, or five unexpected API failures affect at least two users in 15 minutes. Future, expired and cancelled jobs are excluded. Tick completion means dispositions were saved, not that every job succeeded. Individual BHC/reminder problems appear in the owner view and digest rather than creating a broad outage. BHC freshness uses its daily schedule plus a 27-hour threshold.

Use `scripts/setup-monitoring.mjs` with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `MONITOR_SECRET` and a Better Stack team-scoped `BETTERSTACK_API_KEY`; use `BETTERSTACK_TEAM_NAME` for a global token. Preview first, then `--apply`. It reuses two exact named monitors, configuring a five-minute frequency, ten-minute failure confirmation, five-minute recovery confirmation and email alerts. Monitors start paused. The frontend check requires the root element; the readiness check requires HTTP 200. Verify team membership before activation: basic email escalation uses `team_wait: 0` and alerts the team even if its on-call schedule is empty. The current Mendocean team has only the owner. Test incident and recovery on an isolated monitor, then resume the production monitors after a healthy baseline. Re-running setup pauses the managed monitors again for verification. It does not change other monitors or purchase a plan.

See [Better Stack API parameters](https://betterstack.com/docs/uptime/api/create-a-new-monitor/). Better Stack production monitors `5027624` (frontend) and `5027625` (readiness) were activated on October 6, 2026 and verified healthy by the provider. Temporary monitor `5027626` detected an intentional missing keyword, created incident `1027998970`, emailed the sole owner, and recovered automatically when the expected keyword was restored. It is now paused. The owner confirmed incident inbox receipt. Provider logs establish sending, not recovery inbox receipt. The existing GitHub production smoke also checks authenticated readiness twice daily with `MONITOR_SECRET`.

If backups are activated and restore-tested, create a Better Stack heartbeat with 24-hour period and three-hour grace. Add its URL as GitHub secret `BACKUP_HEARTBEAT_URL`. The backup workflow pings only after encrypted artifacts upload successfully. Failed or skipped backups cannot report success. A heartbeat does not establish restoreability; retain the separate restore drill.

## Weekly owner digest

Set Supabase server secrets `OWNER_EMAIL` (a verified, approved administrator's Auth email), `OWNER_DIGEST_SECRET`, and `OWNER_DIGEST_ENABLED=true` only after preview verification. Existing `RESEND_API_KEY`, `EMAIL_FROM` and `APP_URL` are reused. Requests cannot select a recipient; the server checks the configured recipient against approved administrator accounts before sending. Confirm that the existing mail allowance has room for up to five owner emails per month alongside Auth and reminders.

For optional PostHog aggregates, use separate server-only `POSTHOG_READ_KEY`, `POSTHOG_PROJECT_ID` and `POSTHOG_API_HOST` with project-restricted query-read permission. It queries only aggregate views and exceptions, excluding administrator UUIDs. Failure or absent configuration labels analytics unavailable and still permits the application summary.

GitHub needs `SUPABASE_URL`, `SUPABASE_ANON_KEY` and the separate `OWNER_DIGEST_SECRET`; it does not need the job, Resend, database or analytics credential for this workflow. The server flag and repository variable are enabled after a successful live preview. The dedicated secrets and recipient are installed. Delivery is scheduled for Monday at 8 AM Chicago; real provider acceptance and inbox placement remain to be confirmed. The first scheduled window after this rollout is October 12, 2026.

```sh
node scripts/owner-digest.mjs          # preview only, does not reserve or send
node scripts/owner-digest.mjs --send   # both client and server enforce delivery time
```

The workflow attempts Monday at 8:05, 8:25 and 8:45 America/Chicago, with both UTC offsets and a local-time guard for DST. GitHub scheduling is best effort. It covers the previous complete Monday–Sunday local week and compares its predecessor. `workflow_dispatch` defaults to preview. The dedicated digest credential cannot dispatch jobs or export training data, and the ordinary job credential cannot send the digest.

A private weekly key fixes retry content, leases prevent concurrent sends, and Resend receives a matching idempotency key. Retries stop after 23 hours. Successful acceptance prevents another weekly send; the digest has its own one-message-per-week allowance, independent of reminder budgets. Acceptance does not prove inbox placement. If the recipient changes mid-retry, delivery stops rather than reusing content addressed to the old recipient.

## Maintenance and recovery

Disable usage collection by rebuilding with `VITE_TELEMETRY_ENABLED=false`. Pause digest delivery with both the GitHub variable and server flag. Pause/resume external monitors in Better Stack for deliberate maintenance with a recorded end time. Incident monitoring should remain enabled during ordinary operation even if usage mail is paused.

Rotate the monitor secret in Supabase and Better Stack together; check readiness before resuming. Rotate the digest secret in Supabase and GitHub together and verify a read-only preview. Rotate analytics read and build-upload keys independently. Keep old build maps available in PostHog for installed clients; reverting the frontend is compatible with the additive database migration. Revert functions only to a version compatible with the current schema. Do not drop activity tables as an application rollback.

For incidents, inspect the fixed readiness reason, open Supabase job/log views, and search the request ID shown in diagnostics. For browser errors, use build plus chunk/source position in PostHog. If PostHog is unavailable, application saves and the Supabase view continue. If Supabase is unavailable, structured console logs remain the fallback and external readiness fails. Review volumes and alert noise after one and two weeks before the 65-user rollout.

## Validation

`npm test` covers privacy, identity transitions, clock/DST windows, SQL permissions, observation throttling, summary exclusions, queue eligibility, digest lease/retry behavior, pagination and retention. The isolated stack adds real Auth/RPC gates, report retries, heartbeat writes, digest preview/delivery to fixture Resend, production SDK sanitation with intercepted analytics, blocked-provider behavior, owner/member UI and installed-app upgrades. The disposable telemetry build contains a test-only crash fixture and dry-run source-map processing; neither exists in the deployed source.

Real source-map symbolication, the five dashboard queries, and Better Stack incident/recovery processing have been verified with the connected accounts. Owner inbox receipt, error notification destination setup and billing limits remain separate acceptance items; no account plan was changed.

### Administrator account identities

Administration → Accounts & activity shows each saved display name and email address;
accounts without a name use their email as the label. The account ID remains in the
activity detail view for diagnostic searches. Identity lookup is restricted to the
service role and is invoked only after the API verifies administrator access. Emails
are read from Auth on demand, rather than copied to activity or analytics records;
the response uses `Cache-Control: no-store`.
