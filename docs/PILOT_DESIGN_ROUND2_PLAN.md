# Pilot design, round 2: review and implementation plan

Reviewed September 16, 2026. Source: the complete user-supplied `Mendocean.md`, the current production implementation, and provider/browser documentation. This is a planning document; no application changes are included. Continue milestone numbering from the completed implementation milestones 1–4.

## Recommendation and decisions

Confirmed by the user: continue collecting and retaining 15-minute forecast data, and use all available quarter-hour points for interactive chart curves. Only the detailed summary lists are reduced to 30-minute entries. This is a display-density change, not a reduction in ingestion cadence, stored resolution, or chart resolution.

Accept the requested direction. Put reliable Home Screen updates first, then improve the shared weather display, reorganize forecasting, and compact row management. These changes fit the existing web app and services; a native application, new hosting service, or paid upgrade is not required for this scope.

Two preferences were asked separately. Pending a reply, the plan uses these defaults:

- Name the third forecast view **Rows**, because it includes both practices and independent rows. **Practices** can be used instead if preferred; its data should still include both as requested.
- Past shows independent rows and attending practices by default, **plus any row with a saved report regardless of BHC attendance**. Keep an optional Show all practices control for correcting/importing historical records. Otherwise, a later BHC attendance change could hide an existing log. This exception is a recommendation for discussion, not an unnoticed change to the request.

The file refers to an iOS Weather screenshot, but it contains no embedded image and no screenshot accompanied this attachment. The written requirements are sufficient for planning; visual matching can be checked against the image if supplied later.

### Installed-app updates: a real reliability issue

The current frontend registers `/sw.js` on initial mount. It does not explicitly check for updates when a suspended page resumes, handle a waiting worker, react to a replacement controller, or compare the running application's version with `build.json`. Returning to the app refreshes weather, not application code. A new worker activates immediately, but that does not replace JavaScript already running in an open page.

The worker also uses a manually bumped shell-cache name, deletes every older shell on activation, and replaces cached HTML during navigation without first caching all of that HTML's matching assets. These are concrete weaknesses independent of whether they fully explain this particular iPhone's behavior. Verify the installed origin/build and reproduce the foreground/resume path before declaring a device-specific root cause.

Use an explicit update lifecycle on the existing registration. Keep account storage, report drafts, offline reports and push subscription intact. Service-worker replacement is a different operation from deleting the installed app. Browser lifecycle APIs support explicit update checks and controller-change notification; early activation must be coordinated with existing pages. Sources: [MDN update API](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update), [MDN controllerchange](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/controllerchange_event), [service-worker lifecycle](https://web.dev/articles/service-worker-lifecycle).

### Rain chance: missing is not zero

Our current request obtains probability only in the hourly series. Near-term merging prefers quarter-hour records, including their null probability, so even an on-the-hour row can display `—%` despite an hourly value being available. This is a presentation/data-association defect; it does not mean 0%.

Keep probability attached to its actual hourly interval and display a concise hourly rain chance alongside finer wind samples. Open-Meteo defines this as probability for the preceding hour, so match interval bounds rather than blindly flooring timestamps. Other fine-resolution variables can be interpolated upstream; requesting a denser probability series would not establish a new independent half-hour probability. [Open-Meteo definitions](https://open-meteo.com/en/docs).

Use explicit weather-code descriptions such as Light rain when available. Probability and intensity answer different questions, so do not infer one from the other. If probability is missing, use the condition description or “Rain chance unavailable”; never `—%` or invented zero. Do not add hourly probabilities together or label their maximum as the probability of any rain during the whole row.

### Small presentation qualifications

- Remove the verbose current-estimate sentence and prominent degrees. Keep the actual sample time available in compact weather details/accessibility text, and retain actionable stale/missing-data notices. Removing all age information would make a stale estimate look current, especially after renaming Now to Today.
- Accept “bussin’”, “sus”, and “chopped” for the expanded wind key. They describe Hannah's heuristic, with readable colors and accessible labels; the rule itself is unchanged.
- Use a fixed wind axis of **0–30 mph**. Clip plotting to its panel, but mark an overflow at the top and retain the actual numeric gust/wind value in the selected reading. Peaks must not appear to equal 30 mph.
- Interpret the requested vectors as direction plus magnitude: arrows point downwind; “From ENE” describes the source bearing. Use consistent cardinal-direction tests, restrained length scaling, and a calm/missing state. Color vectors with the heuristic. Keep the curve and numeric reading as the precise speed display.
- Touch scrubbing is feasible in the existing SVG component. Draggable window boundaries are also feasible, but need separate hit targets and gesture handling so editing a window does not fight time inspection or page scrolling. Ship the highlight toggle first; treat boundary dragging as the last enhancement in that milestone.

## Issues / action items

Small = localized presentation; medium = shared behavior/state or meaningful verification; large = coordinated lifecycle, navigation, or interaction work. Effort is relative, not a time estimate.

| ID | Action and acceptance | Milestone / effort |
| --- | --- | --- |
| R01 | Detect and apply releases in the existing iOS Home Screen installation. No routine reinstall, sign-in, BHC reconnect, or push registration after an app update. | M5 / Large |
| R02 | Add a concise update-available state and an Account → Check for updates recovery path with current version. Preserve drafts, in-flight work, offline queues and other open tabs. | M5 / Medium |
| R03 | Generate build-specific complete shell caches; verify new assets before activation; retain a working version on failed/offline updates. Test two successive releases on one origin/profile. | M5 / Large |
| R04 | Add an arrow cap to the main wind indicator; share the arrow convention with forecast rows and charts. | M6 / Small |
| R05 | Expanded heuristic key uses green “bussin’”, orange “sus”, red “chopped”; preserve accessible classification and unavailable state. | M6 / Small |
| R06 | Replace user-facing outing/outings with row/rows across navigation, forms, feedback, reminders, notifications and accessibility text. Keep internal API/database names compatible. | M7 / Medium |
| R07 | Current card: remove James Madison Park, verbose current-estimate sentence and visible numeric bearing; keep compact age details and stale/error states. | M6 / Small |
| R08 | Current card and interval rows use meaningful rain chance/condition text. Correct hourly probability association; distinguish missing from 0%. Remove cumulative amounts from those displays. | M6 / Medium |
| R09 | The next few hours contains only compact **30-minute** summaries. Add direction vectors; remove duplicated expanded gusts and precipitation amounts. Keep actual hourly fallback beyond fine coverage. | M6 / Medium |
| R10 | Add a full **Today** chart below those summaries, initially inspecting the latest available sample at/before now. | M6 / Medium |
| R11 | Below Today add a rolling chart with 2–24-hour selector, default 4 hours and domain starting at actual now. Preserve source timestamps; do not relabel an old sample as now. | M6 / Medium |
| R12 | Chart supports finger/pointer dragging as well as tap and keyboard slider. Preserve vertical page scrolling and handle pointer cancellation. | M6 / Medium |
| R13 | Add regularly spaced wind vectors, condition icons and heuristic color indicators to charts. Adapt icon spacing to screen width, independent of underlying data resolution. | M6 / Medium |
| R14 | Use fixed 0–30 mph wind/gust axes, panel clipping and visible overflow indication with exact numeric readings. | M6 / Small |
| R15 | Move selected time/wind/gust/direction/temperature/condition above chart; omit selected precipitation. Remove sample-resolution footer and broad model disclaimer. Retain compact provider/update metadata and real data-error notices. | M6 / Small |
| R16 | Group Today, Week and Rows/Practices beneath Forecasts. Log and My rows remain separate destinations. Preserve old URLs and notification/deep-link behavior. | M7 / Large |
| R17 | Week day selector makes additional days obvious through arrow controls and/or a partially visible next day, with keyboard-accessible selected state. | M7 / Small |
| R18 | Daily expanded sample list uses 30-minute entries where data exist; retain hourly fallback. Charts continue using all available samples. | M6 / Small |
| R19 | Move five-day cards to Week and expand to **seven days**, including today even if its chosen time has passed. Remove redundant section heading. | M7 / Medium |
| R20 | Hide Week's start time and **Duration** controls behind a small labeled Change time disclosure. Preserve selected values; use Madison time and DST-valid conversions. | M7 / Small |
| R21 | Shared duration summary for Week, upcoming forecast rows and My rows: sampled wind range, peak gust, temperature range, useful condition/direction summary, and honest coverage. | M7 / Medium |
| R22 | Add Show on chart toggle to highlight selected date/time/duration without replacing the inspection cursor. Numeric controls remain authoritative and accessible. | M7 / Medium |
| R23 | Allow dragging highlight boundaries, with discrete time snapping, minimum duration, midnight/DST handling and distinct touch targets. Last enhancement after toggle is working. | M7 / Larger, optional follow-up |
| R24 | Replace generic Forecast page with upcoming row forecasts, ordered soonest first and drawn from the same upcoming dataset as My rows. Select a card to inspect its whole scheduled duration. Signed-out state explains account access; public Today/Week remain available. | M7 / Large |
| R25 | Make independent-row actions explicit: **Schedule independent row** for a future plan; **Log independent row** for an already-started row. Both reach the appropriate existing workflow, without signing up for BHC. | M8 / Medium |
| R26 | Compact My rows cards: smaller title, concise date/attendance/summary, few primary actions and secondary details on demand. Preserve touch-target sizes. | M8 / Medium |
| R27 | Attendance details mention requesting changes in BHC or emailing coaches@mendotarowingclub.com, with a mailto link. BHC link targets https://app.boathouseconnect.com/home/login. No emails are sent automatically. | M8 / Small |
| R28 | Remove repetitive ineligible-reminder prose from every upcoming card. Show reminder details where relevant or when requested; keep pause/error/action state discoverable. | M8 / Small |
| R29 | Upcoming filters: Practices / Independent / All, plus Attending / Unknown / Not attending / All for practices. Apply attendance filter only to practice rows; independent rows remain governed by the type filter. | M8 / Medium |
| R30 | Past default includes attending practices and independent rows; retain saved-report visibility under the proposed exception and optional historical override. | M8 / Medium; preference pending |
| R31 | Clearly mark past rows Logged / Needs log / Saved on this device (pending upload). Use text/icon and color, not color alone; preserve report filters and editing. | M8 / Medium |

## Milestone sequence

| Milestone | Outcome | Dependencies / completion boundary |
| --- | --- | --- |
| **5. Reliable installed-app updates** | Existing installations receive new releases safely; update/recovery path is visible. | First, so subsequent design releases reach the pilot. Complete only after a real installed-iPhone A→B update check as well as automated lifecycle tests. |
| **6. Readable weather and Today** | Better arrows/rain text, half-hour summaries, touch-friendly shared charts, full Today and configurable rolling horizon. | Uses M5 release path. No change to meteorological collection cadence or learning data. Shared charts also improve the existing daily view while M7 is pending. |
| **7. Forecasts: Today, Week, Rows** | Coherent forecast navigation, seven-day duration summaries, scheduled-row forecasts, window highlighting and rows terminology. | Reuses M6 charts and introduces one shared summary helper. Boundary dragging is the final optional increment, not a blocker for cards/highlighting. |
| **8. Compact My rows** | Clear scheduling versus logging, efficient cards, filters, attendance links and useful log-status indicators. | Reuses M7 duration summaries. Filter logic is shared with the forecast row list so they do not drift; forecast view need not share the same active UI filter selection. |

Keep scope reviewable. M5 should be its own release. Do not bundle the navigation redesign into the update reliability fix. No new subscription or infrastructure service is proposed.

## Shared forecast summary contract for M7

Summarize the requested interval, not just its first sample. Prefer sampled min–max wind, maximum gust, and temperature range over an unweighted average of mixed 15/60-minute samples. If a mean is later useful, time-weight it. Avoid ordinary arithmetic averages of wind bearings; show a consistent direction or a direction range/variable indication. Use the worst applicable heuristic classification in the interval rather than averaging away a brief difficult period, with details available.

Use actual sample coverage and boundary bracketing. Missing/gapped or out-of-horizon intervals remain visibly incomplete. Do not quietly include a distant sample outside the row to invent complete coverage. Summaries must distinguish sampled estimates from a mathematically continuous bound. Hourly probability can be shown as a range across applicable hours, never as a newly calculated whole-row event probability.

The 30-minute lists are a display reduction; retain quarter-hour ingestion, chart points and stored data. The rolling chart's x-axis can begin at now even if the latest sample is earlier: clip the plotted context and show the actual selected sample time. Today/Week plots retain calendar-day domains. Freeze automatic domain changes during a gesture, then resume normal clock updates without resetting the user's selection unnecessarily.

Preserve existing supported learned-assessment contexts/results through the forecast refactor, behind their existing capability gates. Removing the generic Forecast screen must not remove the model-learning path or change the weather features used by existing models.

## Milestone 5 implementation plan

### 1. Diagnose and establish one release identity

Inspect the running installed app's origin, loaded build, service-worker controller/waiting worker and foreground behavior. Compare with the deployed build. The code findings above are established; the exact iPhone symptom remains to be reproduced. Check response headers for `/`, `/sw.js`, `build.json`, and hashed assets rather than assuming the CDN is serving stale content.

Extend the existing Vite build integration to generate one immutable build identity for the client, service worker, HTML and precache manifest. Use the deployment commit in production and distinct explicit IDs for test releases. The worker bytes must change on every frontend release without manually incrementing a cache version. Keep `/sw.js`, manifest ID `/`, start URL `/` and canonical origin `mendocean.fyi` stable.

Files: `vite.config.ts`, `public/sw.js`, `public/_headers`, and a small new client update module. Preserve the current build.json contract used by deployment smoke checks.

### 2. Install a complete version before using it

Generate a precache manifest containing the exact HTML and static assets for that release, including imported chunks needed offline. Stage into a build-specific shell cache. Verify successful responses, expected asset types and matching release identity; reject partial/CDN-mixed installs. An HTTP-200 HTML fallback for a missing JS file is not a valid asset.

Use a coherent cached shell as the offline unit: never replace cached HTML alone with a different release. Make the navigation and update strategy agree on which version's HTML/assets they serve. Failed downloads, unavailable storage or loss of connectivity leave the working version usable. An update is Ready only after its complete shell is installed.

Retain old assets while older open pages may still need them; use client version reporting and a bounded retention policy rather than deleting every prior cache immediately. Purge only obsolete Mendocean static caches. Never clear localStorage, IndexedDB, Auth state or PushManager subscriptions as an update mechanism. APIs, authentication and personal data stay outside the static cache.

### 3. Add a single client update coordinator

Register the existing worker with cache-bypassing update checks. Check on initial load, returning to a visible app, `pageshow`, reconnecting, and periodically while visible. Deduplicate concurrent triggers and throttle ordinary foreground checks to roughly once per minute; a manual check bypasses that throttle. Do not depend on work executing while iOS suspends the app.

Track checking, downloading, ready, applying and failed/offline states. Handle an already-waiting worker as well as a newly discovered one. Compare running and available build IDs so first installation does not trigger a needless reload. Report a new build only after its worker/assets are ready, not merely because the server exposes a new build.json.

Remove unconditional early activation in favor of a deliberate activation message. On controller change, reload at most once for the intended build and verify the result. Prevent reload loops during CDN propagation, repeated focus events or failed updates. Save enough non-sensitive navigation state to restore the current tab/selection and preserve existing `?log=`, `?join=` and legacy forecast links.

### 4. Apply updates without losing work

Automatically apply a ready release at a safe foreground/launch boundary when no form is dirty and no request is in flight. During active use, show a small **Update available** action; allow postponing it. Do not interrupt sign-in, report editing, attendance submission, independent scheduling, account changes or admin forms.

The logger already persists new drafts with a 350ms debounce; existing report edits and several other forms do not have equivalent persistence. Do not assume every form is protected. Await pending new-draft persistence before reload; defer during unpersisted edits rather than broadening this milestone into saving credentials or every form field. Flush to local storage only, not an unsolicited report submission. Pending offline reports remain queued and their existing submission IDs prevent duplicate uploads.

Coordinate other open tabs using worker/client messages or a suitable channel. A ready worker must not force a dirty tab to reload or evict assets it still needs. One safe tab must not silently destroy another tab's work.

### 5. Add lightweight update controls and recovery

Add Account → App version / Check for updates with useful states: Up to date, Downloading update, Update ready, or Unable to check while offline. Keep a global update notice available to signed-out forecast users too. Place version/debug details in a compact disclosure; the main forecast UI should not show implementation details.

An ordinary update preserves the account session, BHC connection and existing push registration. Unexpected failures remain recoverable by checking/reloading, without recommending deletion of the Home Screen installation. Do not use `Clear-Site-Data`, unregister/re-register the worker, or unsubscribe push to refresh the frontend.

### 6. Test actual A→B updates

Add a same-origin two-build test fixture. Serve production build A, use one persistent browser profile, switch the fixture server to build B, and exercise the real service worker and built frontend. A mocked update-available event alone is insufficient.

Acceptance matrix:

- A→B after foreground/resume, and while already open; B→C proves repeatability without reinstall.
- Signed-in and signed-out users; same session/account after update; existing BHC connection unaffected.
- New draft saved immediately before update, pending offline report, existing-report edits, attendance request in flight and another dirty form.
- Two tabs, one dirty; repeated focus/update triggers; first install; failed/corrupt asset; failed version request; offline update/reopen; CDN metadata/assets becoming available at different times.
- Updated shell opens offline after successful install. Failed install retains the old offline shell. Existing queued report uploads once after reconnect.
- Push registration is not unregistered or unsubscribed during update. Real OS permission/subscription continuity is verified separately on the installed iPhone.

Use focused Vitest state-transition tests and existing Playwright/local Supabase infrastructure where applicable. Run actual service-worker lifecycle tests in engines that support that automation; document any engine limitations rather than presenting mobile emulation as an installed iOS test. Keep traces free of real session/token data.

Files: new focused update tests, `tests/e2e`, `scripts/test-stack.mjs` or a dedicated two-build harness, `tests/smoke`, and `docs/TESTING.md`.

### 7. Release and verify the existing iPhone installation

Use the protected PR workflow with required checks. Confirm the exact build, cache headers and public smoke checks after deployment. No backend migration is expected for M5.

Bootstrap matters: the already-installed old JavaScript has none of the new update coordinator. First try a full online navigation by tapping the existing mendocean header link, or fully close and reopen the Home Screen app. This first transition may need a deliberate reload, but should not require deleting/recreating the installation. Do not attempt to solve it by remotely forcing navigation of a possibly dirty old page. Verify the old shortcut's origin before prescribing recovery.

Then verify the next release through the new update flow in the same installed iPhone app: foreground it, receive/apply the update, retain login and push registration, restore an unfinished draft, and open offline. The owner can perform this short real-device check if the device is not accessible to automation. A normal logged-in push test can verify continuity if the owner chooses it.

M5 is complete when the installed-app two-release transition works without reinstall/re-authentication/re-registration, interrupted work survives, and the automated regression is in CI. Browser-only success is not enough to claim the iOS symptom resolved.

## Milestone 7 implementation plan

Scope: R06, R16, R17, R19–R24, plus the entry-point half of R25 pulled forward
from M8. M7 changes navigation, adds seven-day and scheduled-row forecasts, and
renames outings to rows in user-facing text. It introduces no database
migration, no new service and no change to weather collection cadence. R23 is
the final optional increment and must not gate the rest.

Operating conditions differ from M5. The app has one test user, the owner, and
no external pilot participants. Brief downtime is acceptable. That removes the
compatibility burden that shaped earlier milestones: no reminder emails are in
the wild whose links must keep resolving, and no other installation is mid-
session during an update. Prefer the simpler implementation over the
backward-compatible one wherever the two conflict, and delete dead
compatibility paths rather than preserving them.

Three facts from the code govern the sequence. Navigation is not routed:
`App.tsx` holds a `tab` string in `useState`, and deep links arrive as query
parameters, not paths; `react-router-dom` is declared in `package.json` but
unused in `src/`. `forecastDays` already returns seven days and `weatherURL`
already requests `forecast_days=7`, so the seven-day view is presentation work
rather than new collection. And scheduling a future independent row already
works end to end — `outingPhase` returns `future`, `canLog` withholds logging
until the start time, and the browser case "future outing stays forecast-only"
covers it.

### 1. Rename outings to rows first

R06 touches 205 user-facing occurrences across 14 files. With no live users
there is no reason to defer it, and doing it first means every later step is
built and reviewed under the final vocabulary instead of being relabeled
afterwards. Land it as its own PR before any structural work.

Only user-facing text changes: navigation, forms, feedback, reminders,
notifications and accessibility text. Internal API and database names stay
compatible — `outingSchema`, the `outing` table and its columns, the `?log=`
parameter and the Edge Function payloads are unchanged, as are the internal
exports `outingPhase`, `canLog` and `sortedOutings` in
`shared/presentation.ts`. The 17 class-name occurrences in `src/styles.css` are
churn without user benefit; skip them.

### 2. Establish the shared duration summary

R21 is the dependency for Week cards, scheduled-row forecasts and M8's compact
cards, so build and test it before any view consumes it. Add one exported
helper to `shared/timeline.ts` that takes a sample window and returns sampled
wind min–max, maximum gust, temperature range, a direction summary, the worst
applicable heuristic classification in the interval, an hourly-probability
range, and explicit coverage.

Honor the contract above literally. `forecast_minutely_15` is 192, so only the
first 48 hours carry quarter-hour samples and days three through seven are
hourly: any unweighted mean over a seven-day card silently weights the near
term 4:1. Return ranges and extremes rather than means; if a mean is later
needed, time-weight it by `sampleMinutes`. Use `circularMean` or a
range/variable indication for bearings, never an arithmetic average. Take the
worst classification in the window rather than averaging away a brief difficult
period, and keep the detail reachable.

`windowSamples` already returns `{ samples, covered }` with boundary bracketing
and no extrapolation. Build coverage reporting on that flag rather than
re-deriving it, so a gapped or out-of-horizon window stays visibly incomplete
and no distant sample is quietly recruited to fake a complete row.

Files: `shared/timeline.ts`, `tests/timeline.test.ts`. Pure addition with unit
tests and no UI change; land it on its own.

### 3. Restructure navigation

The nav is the list `["Now", "Hourly", "Forecast", "Log", "My outings"]`, which
appears three times in `App.tsx` (lines 44, 300, 336) and must not drift.
Extract one destination table — internal id, visible label, grouping — and
derive the nav, the `ForecastView` predicate and the resume whitelist from it.
Group Today, Week and Rows beneath Forecasts; Log and My rows stay top level.

Name the third forecast destination **Rows**, not Practices: it lists scheduled
independent rows alongside BHC practices, so the narrower label would be wrong,
and Rows matches the R06 vocabulary.

Keep `/?log=<id>` and `/?account=1` working. They are generated server-side by
`supabase/functions/_shared/notifications.ts` (lines 50 and 235), so changing
them means a coordinated Edge Function deploy for no user-visible gain. Drop
the `?tab=Plan` legacy alias and the legacy-name handling in the resume
whitelist at `App.tsx:44` instead of extending them — with one user and no
external links, they are dead weight, and carrying them forward would preserve
vocabulary R06 just removed.

Files: `src/App.tsx`, `src/ForecastView.tsx`.

### 4. Split ForecastView before adding to it

`ForecastView.tsx` is 672 lines and already branches across three tabs, with
`dayView` rendered from two of them. Adding Week controls, scheduled-row cards
and highlighting in place will not stay reviewable. Split it into Today, Week
and Rows components over shared helpers as part of this milestone, not as a
follow-up. Today keeps the current card, near-term list, Today chart and
rolling horizon and should come out of the split behaviorally unchanged, which
makes it the check that the split was clean.

### 5. Week: seven days, disclosure, day affordances

The seven-day cap is not in `forecastDays`, which already slices to seven. It
is in `comparisonTimes`, which slices to five and filters
`Date.parse(d.time) >= now`. R19 wants today included even when its chosen time
has passed, so both the slice and that filter change together; a day whose time
has passed shows as past rather than disappearing. Verify the seventh day
degrades honestly when the provider is short, rather than rendering an empty
card.

R20 moves start time and Window behind a small labeled Change time disclosure,
preserving selected values and DST-valid Madison conversion via `chicagoToISO`.
R17 makes further days obvious through arrow controls or a partially visible
next day, with a keyboard-accessible selected state — the existing
`.day-picker` already carries `aria-pressed`, so extend it rather than
replacing it.

Cards summarize the two practice windows, not the calendar day. A
whole-day summary answers a question nobody asks: checked against live
data, today reads unfavorable across the calendar day because of
afternoon wind, while 5:30-7:30 reads favorable. Six of eight days
summarized identically as unfavorable for that reason, which is the
wrong interval rather than a defect in the summary. Define the windows
as fixed constants in `shared/domain.ts` alongside `ROUTES` and
`BOAT_CLASSES` - morning 05:30-07:30 and evening 18:00-20:00, the same
every day - and derive each day's bounds through `chicagoToISO` so DST
is handled. Real BHC practice times are a later refinement, not a
prerequisite.

Each day therefore carries two summaries from step 2. Remove the
redundant section heading.

### 6. Rows: scheduled-row forecasts replace arbitrary-time planning

There is no arbitrary-time forecasting destination. To ask about a specific
future time, schedule an independent row for it; the row then appears as a card
under Forecasts → Rows, ordered soonest first, and selecting it inspects its
whole scheduled duration through the step 2 summary rather than a single start
sample. The signed-out state explains account access; public Today and Week
remain available without an account.

A precursor exists: the Forecast tab already renders "Your upcoming outings"
with an `onForecast(outing)` callback over the same dataset as `OutingsView`.
Share that selection so the two lists cannot drift, while allowing the forecast
view its own active filter selection.

Because this removes the only other way to ask about a future time, pull R25's
entry-point labeling forward from M8 into this step. The underlying capability
already works; what is missing is that the sole entry is labeled **Log**, which
reads as recording something that already happened, leaving scheduling
discoverable only by accident. Make the two actions explicit — **Schedule
independent row** for a future plan, **Log independent row** for one already
started — both reaching the existing workflow without signing up for BHC. This
is labeling and routing, not new capability. R26–R31 stay in M8.

Do not lose the learned-assessment path when the planner goes. The estimate
block, `capabilities`, `contexts` and the basis selector are gated
model-learning surfaces that must be preserved behind their existing gates with
unchanged weather features. Removing the generic Forecast screen must not
remove the model-learning path.

### 7. Window highlighting

R22 adds a Show on chart toggle that highlights the selected
date/time/duration without replacing the inspection cursor — the highlight and
the cursor are separate concerns, and the numeric controls stay authoritative
and accessible. `WeatherChart` already freezes its domain during a gesture and
clips to fixed axes, so the highlight must respect the frozen domain rather
than reading live clock state mid-gesture.

R23 adds dragging of highlight boundaries with discrete snapping, a minimum
duration, midnight/DST handling and touch targets distinct from the existing
scrub gesture. It is explicitly the last optional increment. Land R22 and
confirm it before starting R23, and drop R23 rather than delaying the
milestone.

### 8. Verification

Extend the preview browser suite with the new destinations and with scheduling
an independent row and finding its card under Rows. Unit-test the step 2
summary directly against mixed 15/60-minute windows, gapped windows and
out-of-horizon windows, since its honesty guarantees are not observable from a
rendered card.

Both `fast` and `full-stack` are required on the protected branch. Ignore the
`Workers Builds: mendocean` check: no Cloudflare Worker exists in this repo,
and it fails on every commit. After deployment, run exact-commit public smoke
and production browser smoke, and verify seven-day cards and scheduled-row
forecasts at phone width against real provider data, where days three through
seven are hourly.
