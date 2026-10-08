# Owner actions and recurring reviews

This checklist distinguishes implemented automation from actions that require credentials, deployment, judgment, or independent recovery keys. Do not mark a task complete based only on local tests.

## Weather activation status — October 8, 2026 (UTC)

- [x] Applied `202610080001_weather_observations.sql` after the dry run identified it as the only pending migration. Deployed both functions, then merged [PR #90](https://github.com/grahamfindlay/mendocean/pull/90). The exact merged commit passed live frontend, asset-integrity, Auth/privacy and readiness checks. Existing Cron/Vault secrets were preserved.
- [x] Verified live forecast, buoy and IEM collections, private raw archive readback, observation/receipt timestamps, station IDs and preserved null gusts. The latest forecast archive contains both original response and normalized forecast (schema 2); legacy archives remain readable. Prior-day buoy/IEM backfills and enrichment for all seven existing reports completed, with no overdue or failed jobs at the verification checkpoint. Their missing historical measurements remain explicit; forecast associations preserve their provenance. Anonymous archive/report access and unrelated-user report lookup were denied. Required integration/browser CI additionally verified source-failure isolation, cross-member access denial and historical-fallback labels.
- [ ] Supply a free **Visual Crossing API key** as server secret `VISUAL_CROSSING_API_KEY` to start the default James Madison Park trial. First attempt starts its 60-day clock. Verify `queryCost=1`, source `obs`, stations and attribution. No public Query Builder scraping runs in production.
- [x] Installed the three private evaluation secrets and set `WEATHER_EVALUATION_ENABLED=true` independently of backup/training activation. The [first live workflow](https://github.com/grahamfindlay/mendocean/actions/runs/37729642918) succeeded; its default seven-day window ends before observation collection began and correctly has no observations. A separate latest-hour evaluation successfully plotted actual buoy/IEM data and archived forecasts. Download artifacts before their 90-day expiration if permanent retention is needed.
- [x] Both existing external monitors were verified active and healthy. The updated readiness endpoint returned 200, and a read-only owner digest preview included weather and storage state; no email was sent.
- [ ] Confirm recovery-email inbox receipt and the first scheduled Monday digest. The earlier incident-email receipt was confirmed; recovery receipt and the October 12 digest remain owner checks.
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

Core weather collection and weekly evaluation are live. VC credentials and independent backup recovery setup remain outstanding. This task does not authorize automatic model publication or a paid-plan purchase.
