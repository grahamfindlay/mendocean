# Owner actions and recurring reviews

This checklist distinguishes implemented automation from actions that require credentials, deployment, judgment, or independent recovery keys. Do not mark a task complete based only on local tests.

## Activate the weather implementation once

- [ ] Apply `202610080001_weather_observations.sql` using the deployment workflow, after checking the migration dry run. Deploy both `jobs` and `api`, then the frontend. Database migration must precede functions that call the new RPC. Preserve existing migration history and Cron/Vault secrets.
- [ ] Verify live collections: forecast, buoy and IEM archives exist; summaries have correct observation/receipt timestamps and nulls; delayed-source failure does not block the others. Verify an own report's association and deny another member's access. Test both the historical-fallback label and old forecast archive readability.
- [ ] Supply a free **Visual Crossing API key** as server secret `VISUAL_CROSSING_API_KEY` to start the default James Madison Park trial. First attempt starts its 60-day clock. Verify `queryCost=1`, source `obs`, stations and attribution. No public Query Builder scraping runs in production.
- [ ] Install `SUPABASE_URL`, `JOBS_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` as private GitHub secrets for `weather-evaluation.yml`. Set `WEATHER_EVALUATION_ENABLED=true` independently of backup/training activation; run the workflow manually once and inspect its metrics and figures. Download an evaluation artifact before its 90-day GitHub expiration if it needs permanent retention; the raw evidence remains in Supabase.
- [ ] Verify the existing external readiness monitor is running and delivers incident/recovery notifications. The updated readiness endpoint includes observation failures and storage warnings. Confirm the weekly owner digest includes source state and VC review due.
- [ ] Activate the existing encrypted database/weather backup workflow, install its recovery/encryption secrets, and perform an isolated restore drill using [DEPLOYMENT.md](DEPLOYMENT.md). Keep the decryption/recovery keys outside Supabase/GitHub. Free Supabase has no automatic database backups, and database backups do not include Storage file contents.

## Recurring owner reviews

- [ ] **Weekly initially:** read the automatic weather evaluation artifact and owner digest. Inspect missingness, delivery delay, gust flags, direction coverage and forecast lead performance. Check Supabase database, file-storage and egress usage. Routine collection, retries, daily backfills and archive compaction need no manual trigger.
- [ ] **After 30 days, and by the automatic 60-day VC stop:** decide whether default VC contributes useful information across varied directions and row reports. Inspect API behavior separately from the original public-UI experiment. Leave stopped, or explicitly extend with `--vc-trial-days 30` (up to 60). Collection does not restart without that decision.
- [ ] **After 90 days:** review whether raw buoy minute records add value beyond five-minute summaries and row associations. Choose a retention/export policy. Raw files will not be deleted automatically. Original forecast vintages and complete observation-summary history remain long-term evidence.
- [ ] **Monthly, and after backup changes:** restore a recent encrypted database dump and weather archive into an isolated target. Verify report counts, own-user access, forecast archive reads, cold observation lookup and credentials recovery. A successful upload does not prove recoverability. GitHub backup artifacts expire after seven days; maintain a separate long-term copy if required.
- [ ] **At a 70% capacity warning:** review growth and leave room for other app data. At 85%, arrange verified archive relocation or a Supabase upgrade before hitting the Free limits. Do not delete sole copies to free space. Repeated full backups/downloads also consume egress.
- [ ] **When reports cover enough outings, outcomes and directions:** review chronological held-out forecast-to-rowability results from the existing shadow-training workflow. Publish a model only through its manual eligibility/revision gates. Do not apply the one-day provider offsets as forecast corrections or thresholds.
- [ ] **When a source remains unavailable or its schema changes:** investigate the source-specific failure, repair the adapter if necessary, and verify recovery. Seasonal buoy absence remains explicitly missing lake data; decide whether its outage should be treated as expected seasonal operation before changing monitoring.

## Operations reference

Collection, delayed-observation repair and five-minute summaries: [WEATHER_DATA.md](WEATHER_DATA.md).
Deployment and independent recovery: [DEPLOYMENT.md](DEPLOYMENT.md).
Existing provider/account monitoring setup: [MONITORING.md](MONITORING.md).

Live activation and credential-dependent verification are outstanding until individually checked above. This task does not authorize automatic model publication or a paid-plan purchase.
