# Pilot design review and implementation plan

Reviewed September 15, 2026 against the current application, Hannah's source and live dashboard, and provider documentation. Milestone 1 implementation and verification are recorded in [PILOT_DESIGN_M1_DELIVERY.md](PILOT_DESIGN_M1_DELIVERY.md). Milestones 2–4 remain planned.

## Recommendation

Accept the direction of these notes. The pilot should put weather and useful actions first, remove promotional copy, and distinguish forecasting, logging, and attendance. Most requests are interface work. The substantive additions are finer weather data, interactive charts, multiple reminder channels, and writing attendance back to BHC.

Implement four milestones in order:

| Milestone | Deliverable | Relative effort / dependencies |
| --- | --- | --- |
| 1. Clear forecasts and outing workflows | Concise screens; readable wind display; honest timestamps; useful upcoming/past views; correct logging and reminder controls; iOS setup guidance; club-colored icon. | Medium. Mostly frontend, with limited account/reminder API work. No new service. |
| 2. Forecasts over an outing and a day | Quarter-hour near-term data, horizontal charts, day selection, and precise time/window forecasts. | Larger. Weather ingestion and caching, chart interaction, accessibility, temporal tests. Builds on M1 forecast components. |
| 3. Email and push together | Independent channel choices and reliable delivery/retry behavior for both. | Medium. Preferences and delivery migrations plus worker changes. Can follow M1 independently of M2. |
| 4. BHC attendance editing | Change your own attendance before its deadline, with verified provider state. | Medium, with provider uncertainty. Begin with a bounded contract verification; do not block other milestones on it. |

M1 addresses misleading controls before adding new ones. M2 is the next substantial product improvement. M3 and M4 are independently releasable; their order can change without redoing M1.

## Findings and decisions

### Weather time and the heuristic

The hourly interval comes from the current hourly weather request. In addition, the client permits an hourly timestamp up to 30 minutes old in its upcoming list, prefers a cached `current` object for the main panel, and refreshes weather every 30 minutes. These are separate causes of the “9:00 at 9:24” experience.

Open-Meteo offers quarter-hour data and model-derived current conditions; finer timestamps are not live lake observations. A read-only request near Mendota returned 13 consecutive quarter-hour samples with non-null wind, gust, direction, temperature, precipitation, and weather codes. Variable provenance still matters: some fine-interval values can be interpolated upstream. [Open-Meteo documentation](https://open-meteo.com/en/docs).

Recommendation: M1 fixes stale selection and displays the actual data time. M2 shows the latest quarter-hour estimate for Now, followed by the next quarter-hour boundaries over two hours, then hourly forecasts. At 9:24, the next timeline point is 9:30. Do not relabel an old hourly value “9:24” or manufacture intermediate observations. A literal continuously changing “now” is less valuable than an accurately timed estimate and the next 90–120 minutes.

`hannah-1.0.0` is the version of the wind classification heuristic, not the meteorological model. Use **“Wind colors: Hannah’s heuristic”**, with its version in details, and show **“Weather: Open-Meteo”** separately. When a fitted assessment is actually active, identify that separately. Do not label Hannah's rule “Forecast model.” The weather response currently uses the misleading field name `model_version`; M1 can correct presentation without changing stored historical payloads.

### Wind presentation and charts

Hannah's fetched Now panel uses a small four-direction compass with a marked source bearing beside a large colored wind speed. This is distinct from her larger heuristic diagram below it. Use the former as the reference, including an explicit **“From WSW (240°)”** label. Her compact forecast cards also use gust shorthand and plain weather descriptions. [Hannah's dashboard](https://hwaymentsteele.github.io/mendota-weather/).

Remove the requested category phrases from the ordinary display. Color the speed, retain readable numbers/directions, and provide an accessible explanation of the wind classification. Color alone cannot communicate the classification to everyone; a compact optional key with non-color markers can supplement it without restoring the large verbal status headings.

The chart idea is sensible. Use aligned plots sharing time, rather than temperature, precipitation and wind on a single overloaded vertical scale. Wind speed and gusts share an mph axis; temperature and precipitation have separate axes; direction is a compass strip. The vertical detail list remains useful for exact values, keyboard access, and small screens.

### Reminders and outing state

Current reminders ask the user to **log the outing**, not to attend it. Imported BHC practices generally enable the per-outing reminder when attendance is Attending, unless the user has skipped it. Delivery additionally requires an enabled account channel, reminders not paused, and no saved report. The automatic eligibility window is scheduled end +15 minutes through end +24 hours.

The present “Remind me” button mixes an action with a preference, while “Remind me in 1 hour” requests another delivery. The backend already suppresses reminders for saved reports; the cards incorrectly keep showing controls. Correct both the language and the state-dependent availability. A preference being on must not be presented as proof that a notification was scheduled or delivered.

For logging, use the **scheduled start** as the availability boundary: no future outing choices or log buttons, but allow a row already underway to be logged after an early return. “Upcoming” can contain an explicitly marked “In progress” group until scheduled end; completed outings go in “Past.” This is the plan's default, not a question blocking progress. If advance cancellation logging is later desired, give it an explicit separate action rather than quietly reopening all future log forms.

### BHC attendance

BHC documents `POST practices/setAttendance` for Attending / Not Attending, defaulting to the authenticated user, with no special permission requirement. It also documents a separate request endpoint for changes after the attendance window closes. Unknown is not documented as a value for setting one's attendance. [BHC practice API](https://app.boathouseconnect.com/home/apidocs/8).

Therefore this is feasible in principle, not merely speculative. M4 must verify actual account eligibility, deadline behavior and readback. Display Unknown when supplied by BHC, but do not offer resetting to Unknown without demonstrated support. Use the provider's attendance window and permission flags rather than hardcoding 5pm. The first release of editing should handle pre-deadline changes; direct users to BHC for late requests. Adding an in-app late-request form is a separate optional extension.

### Notification choices and iOS

Allow both email and push. The current single-choice design is an implementation simplification, not a fundamental requirement. Both selected should intentionally mean both deliveries; a failure of one must not resend the successful other channel. Keep device registration separate from account delivery preferences, with a clear visible connection between them.

On iOS/iPadOS, web push requires a Home Screen web app on a supported version. Show setup guidance before the user presses an unusable button: open in Safari → Share → Add to Home Screen → open the installed app → enable push. Where offered, leave “Open as Web App” on. Permission must follow a user action. [WebKit push guidance](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Apple installation instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).

## Issue inventory

“Small” means a local presentation change. “Medium” means multiple components or state contracts. “Larger” means a new data or integration path. These are scope descriptions, not time estimates.

| ID | Action and acceptance | Milestone / effort |
| --- | --- | --- |
| D01 | Remove Now's three quoted introductory lines and “Your ten-second report helps the next row.” Keep a concise log action. | M1 / Small |
| D02 | Fix Now's time selection and refresh-on-return behavior; show forecast valid time separately from retrieval time. Never present a past hourly sample as a new measurement. | M1 / Medium |
| D03 | Add 15-minute steps for the next two hours, followed by coarser steps. Retain explicit hourly fallback when fine data are unavailable. | M2 / Medium |
| D04 | Add day-selectable horizontal wind/gust, temperature, direction and precipitation views; share them across relevant forecast screens, with a detail list below. | M2 / Larger |
| D05 | Replace the existing Now vector with Hannah-style four-direction compass, source-bearing marker and “From” text; use consistent direction conventions everywhere. | M1 / Small |
| D06 | Replace favorable/caution/unfavorable headings and row labels with colored wind numbers throughout. Preserve an accessible way to interpret classification. | M1 / Medium |
| D07 | Remove “Starting with…” and the long generic disclaimer. Explain wind heuristic versus weather provider once; put the version in details. Retain “Conditions inform your judgment. They don’t replace it.” | M1 / Small |
| D08 | Remove Hourly's “Find your window” and redundant mph prose. Units remain adjacent to values or on the applicable chart axis. | M1 / Small |
| D09 | Rename Plan to **Forecast**. Add “Choose a date and time, or an outing, to see its forecast.” Keep date, time and duration prominent. | M1 / Small |
| D10 | Hide Route, Boat, Use observations and Coach factor until the active validated assessment supports the relevant choices. Hide heuristic fallback panels ahead of results. Retain useful fitted results when available. | M1 / Medium |
| D11 | Add compact Gxx gust display and weather descriptions using existing weather codes; keep gust meaning accessible. Preserve chosen minutes in point/window calculations and five-day comparisons. | M1 presentation; M2 temporal precision / Medium |
| D12 | Remove Log's “Your time on the water matters.” Keep “A small effort. A better forecast.” Signed-out text: “Sign in to log practices and independent rows.” Remove public-forecast promotional sentence. | M1 / Small |
| D13 | Exclude not-yet-started outings from the logger; order eligible unlogged outings most recent first. Preserve the current outing when editing. | M1 / Medium |
| D14 | Change successful save confirmation to exactly “Report saved.” Keep offline queued-save and failure messages accurate and distinct. | M1 / Small |
| D15 | Add Upcoming and Past views. Upcoming: soonest first, with in-progress distinction and an outing forecast action. Past: most recent first; All / Unlogged / Logged filters; saved-report summaries and edit actions. | M1 / Medium |
| D16 | Rename independent planning action and modal to **Add independent outing**. State that this schedules a personal outing and does not sign up for a BHC practice. | M1 / Small |
| D17 | Make Attending / Not attending / Unknown prominent on BHC cards; reduce title size. Do not imply independent outings have BHC attendance. | M1 / Small |
| D18 | Enable attendance changes in BHC from Mendocean, with provider deadline checks and confirmed state. | M4 / Medium |
| D19 | Remove log actions from future cards; use forecast action instead. Past saved reports show View/Edit rather than another log action. | M1 / Medium |
| D20 | Replace ambiguous reminder buttons with explicit logging-reminder status and relevant actions. No reminder controls on logged outings, no redundant actions, no impossible one-hour reminder beyond expiry. | M1 / Medium |
| D21 | Add iOS installation instructions and distinguish unsupported, not installed, permission needed, denied and registered-device states. | M1 / Medium |
| D22 | Let email and push be selected independently, with migration and per-channel delivery/retry accounting. | M3 / Medium |
| D23 | Recolor the Mendocean icon using MRC green/gold with dark detailing; regenerate favicon/PWA/Apple icons and verify small-size legibility. | M1 / Small |

The icon direction is based on the supplied [MRC logo](https://mendotarowingclub.com/resources/Pictures/MRC_color_logo_horiz.png), visually reviewed. Sample exact colors from the source asset during implementation; retain Mendocean's own symbol rather than squeezing the horizontal club wordmark into a favicon. Keep brand colors independent of wind classification colors.

## Milestone 1: detailed implementation plan

### 1. Establish shared display state

Add small, pure helpers for outing phase, sorting, log eligibility, current/future forecast sample selection, and reminder presentation. Pass a clock value into helpers so tests can cover boundaries without real waiting. Reuse them in My outings and Logger; avoid each screen inventing different date cutoffs.

Suggested boundaries:

- Future: `now < starts_at`.
- In progress: `starts_at <= now < ends_at`.
- Past: `ends_at <= now`.
- Logging: outing has started; existing edited reports remain accessible.
- Reminder time: apply the existing end +15min and end +24h policy, including account and report conditions.

Keep Chicago as the outing timezone. An open screen updates when time passes, without requiring navigation; focus/visibility return also recomputes state. Preserve draft and offline outbox behavior.

Primary files: `shared/domain.ts`, `shared/reminders.ts`, new focused presentation helpers as needed, `src/App.tsx`, `src/Logger.tsx`.

### 2. Simplify the forecast surfaces

Extract a reusable wind display/compass from `src/ForecastView.tsx`; apply it to Now, rows and compact outing forecasts. Match the source-bearing convention, rather than simply changing the current arrow's artwork. Retain visible mph, degree/cardinal direction and null-value handling. Use neutral presentation when weather is expired or classification unavailable.

Implement D01, D06–D12 and D14 copy changes in `ForecastView.tsx`, `App.tsx`, `Logger.tsx`, and `styles.css`. Keep actionable stale-data and network error messages. They convey current system state rather than generic disclaimer copy.

Use existing weather codes for descriptions such as Clear, Partly cloudy, Rain and Fog. Do not promise the exact combined descriptions supplied by Hannah's different weather provider. Make G17 read as “gusts 17 mph” to assistive technology and in expanded details.

Rename the visible Plan tab to Forecast while preserving existing navigation/deep-link compatibility. Keep the independent outing form separate. Put the selected forecast immediately after its time controls. Move provenance/version to a compact trailing detail area.

Determine supported assessment controls from validated model availability, not merely the presence of training code. Add a minimal capability response if needed in `supabase/functions/api/handler.ts`; do not send model coefficients or other users' personal model availability to the browser. In heuristic-only mode, show none of these controls or the repetitive fallback panel. In fitted mode, show only supported choices and useful results. Retain original model-training and report fields.

### 3. Make Now's clock behavior honest

In `App.tsx`, refresh cached weather on returning to a visible app when its retrieval age warrants it; deduplicate requests. Use a lightweight clock update for selecting samples, distinct from network polling. In `ForecastView.tsx`, remove the 30-minute lookback from the upcoming list and separate the main estimate from future rows.

The main panel should show the available current estimate's valid time. If it is too old or absent, use a clearly timestamped hourly fallback rather than silently calling it current. Retrieval time should be labeled Updated, never confused with forecast valid time. Keep existing stale/expired behavior.

M1 intentionally retains the current hourly dataset. It fixes the misleading display but does **not** claim to deliver the 15-minute timeline, which is M2's acceptance criterion. Do not round old data forward to a new label.

### 4. Rebuild My outings around time and purpose

Extract an `OutingsView` / `OutingCard` as needed from `App.tsx` to keep the behavior manageable. Default to Upcoming; preserve the user's chosen view/filter while they edit or save. Use the ordering and controls below.

| Outing state | Display and primary actions | Reminder treatment |
| --- | --- | --- |
| Future practice | Attendance badge; smaller title; date/time; View forecast. No Log action. | “Logging reminder: On/Off” plus one appropriate control. Explain account-level pause/disabled channel when applicable. |
| Future independent outing | Independent label; date/time; View forecast; existing owner/share actions. | Same logging-reminder language; no BHC attendance widget. |
| In progress, no report | Mark In progress; View forecast; allow Log outing for early return. | State that the normal logging reminder follows scheduled end. |
| Past, no report, within delivery window | Log outing first; one-hour logging reminder action only when it can be honored. | If pending, say “Remind me to log in 1 hour”; if previously sent, “Remind me again in 1 hour.” Show scheduled time after success; provide one off action. |
| Past, no report, account reminders disabled | Log outing; compact settings link. | Explain reminders are off/paused. Do not show an apparently working schedule action. |
| Past, no report, outside window | Log outing. | No automatic-reminder controls. This does not expire the ability to log. |
| Saved report | View/Edit report, existing delete behavior. | No enable/skip/snooze controls. |

An attending badge must remain separate from reminder preference. Not attending and Unknown never imply eligibility for an automatic reminder. Keep these practices visible; do not silently hide them or equate not attending with a weather cancellation.

Upcoming View forecast should open the renamed Forecast tab with the outing's start and duration selected. A compact preview can use the current hourly data, explicitly labeled by time. Beyond the available horizon, show “Forecast not available yet.” Preserve this selection through rendering instead of reverting to tomorrow at 7am.

Past All / Unlogged / Logged filters concern the current user's report. Saving moves an outing into Logged immediately. Opening its report preserves the existing form data and edit/version behavior.

### 5. Align reminder status with backend facts

The account response currently exposes a reminder boolean, not sufficient delivery state for the proposed labels. Add a narrow authenticated projection for the current user's outings: preference/skipped state and, where applicable, pending due time or last sent time. Derive it from the existing job/delivery records. Do not expose credentials, other users' deliveries, or raw job payloads. Keep private-table access on the server.

The server must also reject obsolete schedule requests: already logged, ineligible attendance, paused/disabled delivery, or a proposed snooze beyond end +24h. This prevents stale browser state from reporting a successful reminder that cannot be sent. Use current server time. After a mutation, return/refetch authoritative presentation state.

Retain the existing generation/idempotency mechanism. Report submission still suppresses delivery when a queued worker runs. If a minimal read function is required to project private state, add a narrowly scoped migration; no delivery schema redesign or dual-channel change belongs in M1.

Files: `supabase/functions/api/handler.ts`, `shared/reminders.ts`, `supabase/functions/_shared/notifications.ts` as needed, account/outing response types, existing reminder migration patterns. Review BHC synchronization so a deliberate per-outing opt-out remains respected.

### 6. Account guidance and icon assets

In `src/Account.tsx`, show installation instructions before a permission request on an uninstalled iOS device. In an installed app, show the normal explicit Enable push action. Distinguish a denied permission from a missing registration; retain the existing test notification action. Make clear whether the account is currently set to receive logging reminders via the registered device.

M1 retains the single channel preference pending M3, but removes confusion between registering a device and choosing delivery. No permission prompt occurs on page load.

Update `public/icon.svg`, generated 180/192/512px icons, favicon references and `public/manifest.webmanifest` as appropriate. Check favicon size, masked Home Screen presentation and installed-app cache behavior. Use the club palette for the app identity without changing the meaning of wind colors.

### 7. Verify and release in reviewable pieces

Suggested PR sequence within M1:

1. Forecast copy, wind display, model labeling/capability gating, timestamps and Forecast navigation.
2. Outing views, logger eligibility, reminder state contract and controls.
3. Account install guidance, icon assets, responsive visual polish and integrated acceptance review.

Meaningful automated coverage:

- Fixed-clock cases: Sept 15 with a Sept 16 practice; immediately before/at start and end; midnight; timezone/DST behavior; stale current data; advancing an open tab.
- Compass source directions at 0/90/180/270 degrees, north wraparound, calm/missing wind and missing direction. Numeric wind thresholds remain unchanged.
- Upcoming ascending / Past descending ordering; filters; independent outings; no future logger option; existing report editing; forecast action preserves start/duration.
- Reminder matrix: logged report; not attending/unknown; account disabled/paused; opted out; pending; sent; one-hour snooze within/beyond expiry; stale client mutation; isolation between users; resync preserves skip preference.
- Heuristic-only controls absent; validated supported controls/results present; weather-provider and heuristic identity distinct.
- Existing offline draft/outbox and authenticated logging journeys still pass. An offline queued report is never called saved on the server.
- Mocked installed/uninstalled iOS capability states for guidance; one real installed iPhone check for instructions, icons and notification interaction when available. Desktop emulation cannot establish actual iOS push delivery.

Use the existing Vitest, Docker/Supabase integration and Playwright suites (`npm test`, `npm run build`, `npm run test:e2e`, `npm run test:stack`). Extend behavioral tests rather than writing a brittle test for every deleted sentence. Check desktop/mobile layouts and keyboard/screen-reader labels; screenshots are review aids, not the only correctness check.

After required CI checks pass, use the normal protected-branch release process and read-only production smoke checks. If account API or a migration changes, deploy the backward-compatible backend before its frontend consumers. Do not test writes against real BHC attendance or send reminders to pilot users as part of unattended tests.

M1 is complete when all its inventory items pass the stated checks, the future/prior outing distinction is unambiguous, no saved report offers logging reminders, and the app's weather time and heuristic labels describe what it actually knows.

## Boundaries for later milestones

### M2: Detailed forecast timeline

- Extend weather ingestion with quarter-hour data for the near term. Retain hourly data for the full horizon. Keep resolution/valid-time metadata explicit and support older cached payloads during rollout.
- Use a shared collector/cache, with freshness suitable for the new interval; do not turn every user's screen refresh into a provider request. Review the current collector's 29-minute skip rule along with client refresh behavior.
- On Now, show the latest available estimate and the next two hours at quarter-hour intervals, then hourly values. On day selection, display that day's available data with clearly indicated resolution.
- Wind: filled speed curve and a lighter, distinguishable gust line on the same mph scale. Add aligned temperature, direction and precipitation plots with tap/keyboard inspection and an accessible value list. Avoid smoothing that conceals peaks or invents precision.
- Preserve precipitation interval semantics. Hourly totals and quarter-hour totals cannot be drawn as comparable raw amounts without labeling or normalization. Do not pretend hourly rain probability is a measured quarter-hour probability.
- Honor the selected minute and full outing window; include coverage around its boundaries. Where only hourly data exist, expose the actual samples/interval rather than pretending to have an exact point estimate. Keep any interpolation policy explicit and use circular math for directions.
- Five-day comparisons use the selected local time; selecting a day opens its detailed timeline. Upcoming practices reuse the same forecast selection. Missing/out-of-horizon data never become zero wind or zero rain.

### M3: Both reminder channels

- Replace the exclusive preference with independent Email and Push choices; neither selected means no reminders. Retain a separate pause control if useful.
- Migrate each existing preference without opting anyone into an additional channel.
- Track reservation, success and retry per user / outing / reminder generation / channel. Update uniqueness and provider idempotency keys accordingly. A successful email is not resent because push failed, and vice versa.
- Preserve report suppression, expiry, quotas and explicit snooze behavior; prevent duplicate work from concurrency. Reflect device readiness and partial delivery failures accurately without treating email as an automatic fallback unless the user chose it.
- Test both selected, neither, one unavailable, partial failures, retries, changed preferences, logged-before-delivery and multiple registered devices.

### M4: BHC attendance editing

- Verify the documented endpoint and pre-deadline permissions with fixtures first, then one deliberate user-chosen real attendance change when implementation is ready. This review did not submit any BHC writes.
- Permit only the authenticated user's attendance. Keep the BHC token server-side; do not accept an arbitrary target user from the browser.
- Read provider eligibility/window, present Attending or Not attending choices, submit once from an explicit action, then confirm the returned/read-back state and resynchronize the outing/reminder preference.
- Handle deadline closure between viewing and submitting, capacity/permission errors, timeout with uncertain outcome and stale local data. Read back uncertain writes before retrying. Do not queue attendance changes offline past their deadline.
- Display Unknown as a provider state; no unsupported reset action. Keep post-deadline requests in BHC for the initial release. An in-app request form would need a reason, pending/approved distinction and separate acceptance tests.
