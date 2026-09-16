# Milestone 2: detailed forecast timelines

## Behavior

Now uses the latest actual model sample and shows the next two hours in 15-minute steps where available, then hourly points through six hours. Open-Meteo supplies 48 hours of quarter-hour forecasts plus one preceding hour, alongside the existing seven-day hourly horizon. A shared collector runs every 15 minutes; browsers check the cached API every five minutes and on return. No production browser calls the weather provider.

Now, Hourly and Forecast share responsive charts for wind/gusts, temperature, source direction and precipitation. Tap a chart or use its keyboard-operable time slider for exact sample values. Wind and gusts share an mph axis with a filled wind curve and lighter dashed gust curve. Day buttons open full-day timelines; the detail list remains accessible below. Linear connecting lines preserve sampled peaks, and missing values/time gaps break paths.

Forecast preserves the selected minute and outing duration. Actual samples bracket point selections and both boundaries of a window; partial coverage is explicitly flagged. No client interpolation or extrapolation invents a value at the selected minute. Five-day comparisons use that same local time and open the selected day's timeline. DST-invalid local times are unavailable rather than silently moved.

Each sample carries its 15/60-minute interval. Rainfall totals retain their preceding-interval meaning; charts normalize them to mean inches/hour for comparison and disclose the original total/interval on inspection. Quarter-hour rain probability is not requested or synthesized. Existing learned assessments continue using the hourly features on which they were trained, identified in the result.

Older cached forecasts work with an explicit hourly fallback. Missing values remain unavailable, not calm/dry. The provider may interpolate some fine-interval values; these are labeled model estimates rather than actual lake observations. Provider contract checked against [Open-Meteo documentation](https://open-meteo.com/en/docs) and a live public request on September 16, 2026.

## Release

No database migration or new service is needed. Deploy `jobs` first to publish the additive weather payload and update collection cadence, then merge the frontend after required CI checks. The dispatcher remains on its existing five-minute cron. Historical enrichment keeps its original hourly request/features, with quarter-hour request parameters excluded. The API reads the stored summary unchanged and needs no deployment.

After release, verify the live quarter-hour payload and exact frontend commit, then run API/Auth/browser smoke checks. Do not send pilot reminders or create observations for testing.

## Validation

Tests cover normalization and interval semantics, 9:24 → 9:30 selection, boundary coverage, old-cache fallback, missing data, midnight and DST, five-day minute preservation, quarter-hour archive/public API data and collector cache reuse. Preview and real-backend browser journeys exercise chart keyboard inspection and day selection. Layouts were visually reviewed at desktop and 390px width. The existing real-device iPhone acceptance limitation remains; browser emulation does not establish OS push behavior.

Local verification passed: production build, both Edge Function type checks, 52 fast tests, 8 Python tests, 14 preview browser cases, 27 real-backend integration tests and 34 production-build browser cases. Two persistent-profile variants remain intentionally excluded outside desktop Chromium.
