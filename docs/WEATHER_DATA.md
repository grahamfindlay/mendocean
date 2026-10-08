# Forecast and measured-weather collection

The weather implementation archives advance forecasts separately from measured conditions. The schema/function changes must be deployed before collection starts; a local implementation is not evidence of a live collector.

## Automatic operation after deployment

- The existing five-minute dispatcher schedules independent jobs in 15-minute buckets: Open-Meteo forecasts, Mendota buoy, IEM MSN, and optional default-station Visual Crossing at James Madison Park. Failures retry with bounded exponential backoff; unaffected sources continue.
- Forecast archives contain the original response, normalized forecast, request configuration, requested/received timestamps, and units. The latest two days remain in the forecast database cache. Earlier archives remain immutable. Old archive formats remain readable.
- Buoy requests retrieve the previous hour of minute records. The database stores completed UTC five-minute bins: mean reported two-minute sustained wind, wind minimum/maximum, maximum reported two-minute gust, circular mean noncalm direction, mean temperature, sample count, expected count, flags, stations, receipt timestamp and raw-file references. These are summaries of overlapping two-minute measurements, not a reconstruction of the instrument's original high-frequency signal.
- IEM combines current and observation-history endpoints, including the local-date boundary. Five-minute bins summarize available point reports; they are not continuous five-minute interval averages. Original METARs stay in the raw archive. Precision temperature derivations are flagged.
- Default VC uses an API key, US units and current conditions only; returned source must identify observations. Station IDs and actual values/nulls are preserved. Neither MSN-only VC configuration is collected. The first collection attempt starts a 60-day trial. Collection stops automatically at its end and appears as review due in Operations and the weekly owner digest.
- A daily job during 01:00–01:59 UTC backfills the previous UTC day from buoy and IEM. Repeated reports do not increase sample counts. Corrections create summary revisions and retain first-recorded availability; each provider response remains immutable in its raw archive.
- Report submission queues forecast and observation enrichment. Administrator actual times take precedence, then each report's actual times, then scheduled times. Each report receives its own forecast and measured conditions; other members cannot read them. Missing observations are not calm conditions. The latest archived forecast within six hours before the interval start is selected. A historical forecast fallback is labeled as retrospectively retrieved, with unverified advance availability.
- Hourly maintenance revisits recent reports approximately every six hours for seven days to incorporate delayed observations. It also processes reports missing enrichment. Source-specific summaries remain separate; airport measurements never silently replace lake measurements. Current model thresholds are unchanged.
- Searchable observations remain in Postgres for 90 days. Hourly maintenance archives one older UTC day, reads it back and verifies its contents, checks that no concurrent correction changed the snapshot, commits its index, then removes the database rows. Archive lookup continues to support late reports. Permanent report associations retain their weather summaries. Finished weather/enrichment job records are pruned after 30 days; raw files and report associations remain. Raw minute responses are retained until an explicit owner retention review; no automatic raw-data deletion is configured.
- The weekly GitHub weather-evaluation workflow scores the preceding seven UTC days and saves aggregate metrics and wind/temperature/direction figures. It runs only when `PILOT_ENABLED=true` and its secrets are installed. It never publishes a model. Results describe source biases, direction sectors, station combinations, delivery delays, missingness, gusts, forecast lead times, row-report coverage and descriptive weather by outcome/rating. Each outing receives equal weight within a group; conflicting reports may put an outing in multiple groups. Historical fallback forecasts are excluded from those forecast summaries.
- Operations and authenticated readiness expose persistent source failures/staleness after a one-hour startup grace, plus warnings at 70% of the Free database/file allowances. The existing external readiness monitor supplies incident/recovery notifications when configured. Buoy freshness limit is 30 minutes; airport/VC is 120 minutes; unsuccessful collection limit is 60 minutes or three consecutive failed attempts. VC trial completion is a review item, not a service outage.

## Storage and evaluation conventions

Weather files share the private `weather-archive` bucket. No credentials or authenticated query URLs are stored. Ordinary members cannot download raw files; their row history shows source-labeled conditions, forecast provenance, available time windows and delayed/suspicious readings. VC attribution appears with displayed VC results.

The five-minute cache reduces buoy database rows by about 80% relative to minute rows. It does not eliminate archive growth. This collector archives overlapping hourly buoy responses and full-day IEM history, so the original experiment's file sizes are not a reliable annual capacity estimate. Measure actual growth after activation and review raw-response retention at 90 days. The database, object metadata, other app records, archive downloads and full backups all consume quotas. Egress must also be checked in the provider dashboard; it is not inferred from file size. Indefinite retention is not guaranteed to fit the Free tier.

Forecast validation uses the original archived vintage nearest a nominal lead (1, 3, 6, 12 or 24 hours), within 15 minutes. Later forecasts never fill missing earlier vintages. Scores use summaries overlapping centered 15-minute windows and also report common targets across leads. Boundary bins, source averaging definitions and serial dependence limit interpretation. Direction means exclude winds below 1 mph. Provider gusts below sustained wind remain flagged rather than corrected. Sparse direction sectors and one day of measurements cannot establish rowability.

Training continues to use forecasts as predictors. Retrospectively retrieved historical forecasts are excluded from new training. Measured conditions are separate evidence for explaining outcomes. Existing chronological holdout/eligibility checks and manual publication remain in force.

## Manual commands

Keep credentials in the existing ignored server environment or CI secret store; never paste them into command arguments or commit them. The evaluation transport uses `SUPABASE_URL`, `JOBS_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY`. Install Python and Matplotlib in the local evaluation environment; CI installs them automatically.

```sh
# Previous seven complete UTC days; aggregate outputs only.
python scripts/weather_evaluate.py --out weather-evaluation

# A chosen window, at most fourteen days.
python scripts/weather_evaluate.py --start 2026-10-08T00:00:00Z --end 2026-10-15T00:00:00Z --out weather-evaluation

# Explicitly stop the VC trial, or grant up to sixty additional days after review.
python scripts/weather_evaluate.py --vc-trial-days 0
python scripts/weather_evaluate.py --vc-trial-days 30
```

Repeated evaluation runs do not change production collection or thresholds. Trial-control commands do change the collection window and require the private job secret. Automatic backfills repair delayed observations only, not missing advance forecast history.

See [TODO.md](TODO.md) for activation, recurring owner decisions, and backup verification. The [24-hour runbook](WEATHER_STUDY_RUNBOOK.md) documents the completed experiment; its desktop heartbeat is not the production collector.
