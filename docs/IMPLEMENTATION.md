# Implementation notes

## Data and access

An outing is the shared event. `outing_members` records who may access it and each person’s attendance/reminder choice. A report belongs to one user and outing, with a unique constraint and optimistic version. The `save_report` RPC serializes retries, records submission IDs and validates critical invariants in PostgreSQL. The Edge Function additionally validates complete inputs with Zod. Invited status is checked in the database even if hosted Auth signups are accidentally enabled. Private BHC tokens, jobs, links, deliveries, weather features and models live outside the exposed schema with RLS and no client grants.

Official outings use the unique BHC club/practice identity. Independent outings use generated UUIDs and optional expiring invitation links. An administrator can reconcile duplicate independent records into the shared event; a merge is blocked if one person has reports on both records, so their conflicting report is never silently discarded. Reports are private to their authors; public access is limited to weather and model estimates, not raw observations.

All instants are stored in UTC and displayed in America/Chicago. Ambiguous and nonexistent daylight-saving times are rejected. Scheduled times, actual reported times and submission times are distinct. BHC coach/boat plans remain distinct from reporter-confirmed facts.

## Forecasts and learning

Hannah’s source was reviewed, but the application is a new implementation. Her exact unrounded sector thresholds are regression-tested. There is no historical training dataset bundled with her page, and none is invented here. Weather comes from Open-Meteo at James Madison Park. The local development server fetches weather directly; production reads the scheduled server cache.

Every archived run is immutable and private. The database holds recent complete summaries plus metadata for older compressed objects. Enrichment first seeks a forecast issued before an outing and uses the historical forecast service when no archive is available. The source kind is retained. Enrichment uses the shared scheduled start until an administrator confirms an authoritative actual interval. Conflicting personal time reports are preserved for review.

Training uses separate weighted binary launch and cumulative ordinal water models. Each outing has total weight one, and all records from the same Madison date stay on one side of the chronological split. Absences and non-weather cancellations are excluded from weather-related launch labels. Launch predictors never use the actually launched fleet. Separate route ratings are used only when explicitly reported; a single “both” rating is not copied into east and west.

Personal models use only the individual’s reports. Route/boat/coach contexts fit only when their own data qualify; coach contexts additionally require at least 20 outings and weather overlap. Initial gates are deliberately conservative: at least 100 distinct eligible outings, at least 20 held-out outings, at least 20 launch examples of each outcome, broader water ratings, improvement over a held-out constant baseline, and calibration error at most 0.15. Water fitting also requires support at every ordinal threshold, including forced-off observations. Sparse contexts return an explicit rule fallback. Estimates are observational, not causal coach comparisons or a safety guarantee.

New model families require manual review. Training stores a dataset revision, and publication fails if that revision changed. Editing or deleting reports retires an active model. The first deployment has no fitted model.

## Background work and limits

The queue has due times, expiry, attempts, claim locks and stable deduplication keys. BHC requests are read-only and serialized per connection. API tokens are AES-GCM encrypted before persistence; neither native fetch errors nor URLs containing tokens are logged. A BHC reservation is not evidence that a boat launched: planned fleet extraction uses occupied lineups.

Reminders are checked again at delivery time. The selected channel is email or push; push failures do not trigger an unsolicited fallback email. Email reminders reserve a budget of 80 daily sends, leaving room under the pilot’s expected provider allowance for authentication. Resend idempotency keys and push notification tags reduce duplicate delivery after retries. Exact cross-provider delivery after an ambiguous network failure must still be verified in hosted testing.

The repository includes encrypted daily database and weekly complete weather exports. No recovery success is claimed until the hosted restore drill passes. Provider usage beyond database/storage sizes remains visible in the service dashboards.

## Current validation boundary

Local production builds, domain/model tests, embedded PostgreSQL policy/transaction tests and server type checks can run without credentials. The sample browser mode is explicitly local and stripped from production. Hosted Auth, BHC import, Cron, SMTP/push delivery, real offline installation and backup restoration require the new Supabase project and sender setup; they have not been exercised against a deployed app yet.
