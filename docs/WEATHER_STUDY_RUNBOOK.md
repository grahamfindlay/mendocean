# Mendota 24-hour provider comparison

The user authorized collection every 5–15 minutes for 24 hours, then systematic analysis in this chat. The study uses a 15-minute Codex thread heartbeat. Keep routine successful samples silent; notify about a sustained failure needing user action and about completion.

Workspace: `/Users/graham/.codex/worktrees/3734/mendocean`.
Study: `data/weather-studies/mendota-2026-10-07/` (ignored by Git).
Automation ID: `mendota-24-hour-weather-comparison`.
Window: **2026-10-07 02:33:52 UTC through 2026-10-08 02:33:52 UTC**, or **October 6, 9:33 p.m. CDT through October 7, 9:33 p.m. CDT**. Use `manifest.json` as the exact source of bounds.

## Each scheduled run

1. Read the manifest and run `python3 scripts/weather_study.py status`.
2. Before the end of the window, run `python3 scripts/weather_study.py sample`. Network access may need `require_escalated`; the user authorized read-only provider requests. The command preserves immutable compressed responses, error records, requested/received timestamps, and sanitized query parameters. It skips duplicate successful API samples in the same 15-minute slot. Do not run `init` again.
3. With `VISUAL_CROSSING_API_KEY` in the environment or `.env.weather-study.local`, all three VC requests are made automatically. Never print the key or source the env file in a shell. This file is ignored by Git. The requests include only current observations to keep record usage small. Forecast snapshots use the application's actual Open-Meteo request from `shared/weather.ts`, keeping the full hourly and quarter-hour responses; modeled current conditions are not called measurements.
4. If the key is unavailable, capture the three VC current-condition configurations through the public Query Builder as below, and ingest them into the snapshot returned by `sample`. Check for existing successful VC files before capturing. Preserve explicit nulls and literal displayed values, including suspicious gusts below sustained wind. Do not substitute a guessed or later observation for an unavailable reading.
5. Verify the successful raw files actually exist. A `run.json` written before browser capture can still say `needs_public_query_builder_capture`; successful `.ui.json.gz` files are the authoritative completion evidence. If a provider fails, preserve the failure and continue unaffected sources. If the same blocking failure repeats, notify the user with what is missing.

The initial sample has all five observation configurations plus an Open-Meteo forecast saved. An initial sandbox DNS failure was recorded and then resolved using an authorized network-enabled request. A temporary `caffeinate -i -t 86400` idle-sleep assertion was started and verified with `pmset -g assertions`; it expires automatically. The window is still dependent on Codex remaining open and the machine remaining powered on.

## Public VC fallback

Use only `mcp__cua_repl` for browser interaction. After a context summary restore documentation with `await cua.rewriteDocumentation()`. Reuse the selected browser binding; the IAB browser ID was `2`. Tabs may have been cleaned up; create a fresh hidden tab in that browser at `https://www.visualcrossing.com/weather-query-builder/`. Read the initial UI and fresh DOM state before choosing controls. Do not extract hidden app state, authentication tokens, or network traffic.

The following controls were verified during setup (recheck the live DOM if they change):

- Welcome modal: button `Close`, exact, `.last()`.
- Initial location textbox: `Enter a location`, exact. Enter `43.0814,-89.3829`, then the exact button ``, `.last()`.
- Current grid button: ` Current`. Unit selector must show `US (°F, miles)`.
- Options button: ` Options`. The `Query Options` dialog contains output checkboxes `Include only level 1 stations` and `Use station observations`, and tab ` Weather Stations`.
- Default James Madison Park: both station options unchecked, maximum distance/stations empty (defaults). Capture this first in a new tab so filters are clean. The current row's `Source` should be `obs`; save its actual station IDs.
- Restricted James Madison Park: check both station options. Select ` Weather Stations`; the three spinbuttons are maximum distance (miles), maximum stations, maximum elevation difference. Fill the first with `5`, second with `1`, leave elevation empty. Click `Save changes` (lowercase c). This yields `maxDistance=8047`, `maxStations=1`, `options=stnslevel1,useobs`. **Wait for the current grid's exact `KMSN` cell to be visible** after saving; the immediate row can still be stale. The returned stations must be exactly `KMSN`, or mark this restricted reading invalid.
- Add airport location: click location button `43.0814,-89.3829`, then link ` Edit locations`. In the location editor fill `Enter a location address or latitude,longitude` with `stn:KMSN`; click exact ``, then `Save Changes` (capital C). Open the location dropdown and select exact link `stn:KMSN`. Keep the restrictions in place. Wait for exact `stn:KMSN` current-table cell before capturing. Verify stations are exactly `KMSN`. A station location alone does not prevent blending other stations.

Capture all visible table cells with a read-only DOM evaluation, including all headers and the one current row:

```javascript
const table = await tab.playwright.getByRole('table').evaluate(el =>
  Array.from(el.querySelectorAll('tr')).map(r =>
    Array.from(r.querySelectorAll('th,td')).map(c => c.textContent.trim())));
```

The second row contains column labels, the third the observation. Find fields by labels, not hardcoded column positions. The exact labels are `Date / Time (Epoch) (secs)`, `Average Temperature (°F)`, `Wind Speed (mph)`, `Wind Gust (mph)`, `Wind Direction (°)`, `Stations`, `Source`, and `Location Name`. **Use the displayed epoch timestamp**; do not infer a date from the current local day. `-` means null; `0.0` is zero as actually returned. Save the complete displayed table as raw evidence.

Transfer the three captures into a local JSON file (using normal file tools; browser REPL is not a filesystem API). Shape:

```json
{
  "vc_jmp": {
    "requested_at": "UTC timestamp when capture began",
    "received_at": "UTC timestamp when row was read",
    "parameters": {"unitGroup":"us", "station_filters":"default"},
    "displayed_table": [["column labels"], ["literal values"]],
    "data": {
      "address":"43.0814,-89.3829",
      "currentConditions": {
        "datetimeEpoch": 1791339600,
        "temp":64.6, "windspeed":2.3, "windgust":0.0, "winddir":184,
        "stations":["F3620","E6030","KMSN"], "source":"obs"
      }
    }
  }
}
```

Those numbers are an **example from the initial sample**, never a template for later values. Also include `vc_jmp_msn` and `vc_msn`; use restricted parameters and their actual displayed values. `vc_msn` address is `stn:KMSN`. Ingest with:

```sh
python3 scripts/weather_study.py ingest-vc --vc-file /private/tmp/ACTUAL-CAPTURE.json --snapshot ABSOLUTE-SNAPSHOT-PATH
```

The script rejects a restricted capture whose station list differs from `['KMSN']`. A preserved tab needs a fresh query each run; do not reuse an old displayed row without re-requesting it. A fresh tab is the simplest way to reset filters. Close temporary tabs when done. Do not sign up for accounts, solve a CAPTCHA, buy a plan, or create credentials to work around a blocker.

## Sources and interpretation

- Buoy API: `https://metobs.ssec.wisc.edu/api/data.json` with `site=mendota`, `inst=buoy`, `symbols=air_temp:wind_speed:wind_direction:gust:run_wind_speed`, `begin=-00:30:00`, `order=row`. Wind in m/s; temperature in °C. `wind_speed` instantaneous, `run_wind_speed` trailing 2-minute mean, `gust` trailing 2-minute maximum; retain all three. One-minute observations are collected in overlapping windows and deduplicated by observed timestamp.
- VC API base: `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/`, location `43.0814,-89.3829` or `stn:KMSN`, `unitGroup=us`, `include=current`. Current observations contain `datetimeEpoch`, wind speed/gust/direction, temperature, and stations. Restricted configuration is verified against the returned current station list every time. API averaging period is not assumed equal to buoy/ASOS.
- IEM: `https://mesonet.agron.iastate.edu/json/current.py?station=MSN&network=WI_ASOS` plus `https://mesonet.agron.iastate.edu/api/1/obhistory.json?station=MSN&network=WI_ASOS&date=LOCAL-DATE&full=true`. Preserve both routine latest METAR and 5-minute MADISHF reports. The current endpoint has literal unit-bearing keys such as `windspeed[kt]`, `winddirection[deg]`, `airtemp[F]`. Some 5-minute parsed temperatures are null even though a precision T-group exists in raw METAR; the analysis derives that temperature, marks it as derived, and retains raw evidence. A missing gust is not calm wind.

## End of the window

On the first heartbeat at or after the manifest's end, stop forecast/current collection. Run `python3 scripts/weather_study.py backfill` to retrieve buoy and IEM observations over the exact study bounds, including delayed station reports. This is a separately marked retrospective observation archive and never a reconstructed forecast. If IEM is still behind the end, wait until a later heartbeat (up to 60 minutes after the end) and backfill again before the final analysis; do not keep polling in one turn or keep the study collecting new forecasts. Preserve any remaining observation coverage gap.

Run `python3 scripts/weather_study.py analyze`. It generates `analysis/metrics.json`, `analysis/observations.csv`, and `analysis/report.md`. Assess these outputs, and extend the written report with findings and readable time-series/scatter charts if they help. The script:

- reports raw collection failures, slot coverage, unique timestamps, freshness, missing gusts, and gusts below wind;
- uses one-to-one nearest observed-time pairs within two minutes, deduplicating repeated snapshots;
- compares sustained winds, gusts, temperatures, circular direction errors (excluding near-calm wind), vector wind differences, correlation, bias, MAE, RMSE, and exploratory affine fits;
- stratifies wind bias by reference wind direction and speed;
- scores archived Open-Meteo predictions by nominal 1/3/6/12/24-hour lead, choosing one vintage per target and lead, with received time as the availability proxy;
- compares those quarter-hour targets to centered 15-minute observation windows (mean sustained wind/temperature, maximum reported gust, circular direction mean). Analyze the unequal averaging periods and sparse observations before interpreting errors.

Check whether the two MSN-only VC locations actually agree and whether IEM matches after timestamps, units and rounding are aligned. Analyze ordinary IEM current endpoint freshness separately from the optional 5-minute feed, since merged freshness otherwise describes the freshest available MSN report. Check station changes in default VC. Explain when correlations or fits are supported by too few distinct readings or too little range; do not infer rowability thresholds from one day without row reports.

After analysis, pause this heartbeat using the app's `automation_update` tool, preserving its fields. Do not edit automation TOML directly. Record completion/coverage and link the report in this chat. The local machine and Codex must remain running for the heartbeat to execute; record missed slots honestly if they do not.
