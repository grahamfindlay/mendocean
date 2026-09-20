# Scheduled rows and forecast chart implementation plan

Status: implemented, verified, and deployed to https://mendocean.fyi.
Created: 2026-09-19. Updated: 2026-09-20.

This is the durable, agent-independent checklist for this work. Update checkboxes, decisions, validation evidence, and the change log in this file as implementation proceeds. A completed item needs implementation and relevant verification, not just a code change. No particular assistant, session, or tool is required to continue it.

## Authority and scope

The user's latest request is authoritative. IMG_6202.png and IMG_6203.png are visual references: use their broad plotting area, quiet readout, icon bands, and vertical guides. Their day navigation and green curves are not requirements; the user explicitly requests different behavior for those. Temporary attachment paths are not needed to execute this plan.

This plan supersedes conflicting choices in `PILOT_DESIGN_ROUND2_PLAN.md` for this work, notably the Rows label, default destination, visible inspection slider, fixed wind ceiling with overflow markers, and Scheduled rows' extra forecasts and detail lists. Preserve the older plan as history.

The user confirmed both scope and icon choices:

1. Remove short-window charts and 30-minute lists from **Scheduled rows only, for now**. Retain Today/Week's separate content. Apply shared chart visual and interaction improvements wherever that chart is used.
2. Use a wind arrow on the wind line and a **weather icon** on the temperature/conditions line.

## Findings from the current code

- `src/navigation.ts` uses Today as `DEFAULT_DESTINATION` and Rows as both destination ID and label. `src/App.tsx` also selects Rows from other views and restores update-resume state. Change navigation without breaking explicit destinations or safe app-update restoration.
- `src/ForecastView.tsx` adds the redundant heading and subtitle. `src/ForecastRows.tsx` owns cards, selected-window chart, vertical sample list, assessment controls/results, chart toggle, and trailing scheduling callout.
- `src/ForecastDayView.tsx` is shared with Week and currently always renders day navigation and expandable detailed samples. Scheduled rows needs a chart-only composition.
- `src/WeatherChart.tsx` owns the slider, inspection readout, fixed 0–30 mph axis, overflow triangles, and annotation positions. Wind and weather icons currently sit below the wind graph.
- `src/styles.css` compounds shell padding, chart padding, and SVG axis margins (currently 48px left and 16px right). The plotted area is narrower than the outer chart. Measure actual plot width, not just the enclosing card.
- `shared/weather.ts` already requests and normalizes hourly `precipitation_probability`. Open-Meteo documents this variable as an hourly probability for the preceding hour. The fine-resolution series does not supply this probability in the current request. Source: [Open-Meteo forecast documentation](https://open-meteo.com/en/docs).
- `shared/timeline.ts` already provides `hourlyRainChance`, day boundaries in America/Chicago, and window summaries. Its merged timeline prefers quarter-hour samples, whose null probability can mask hourly probability: the probability graph must use the hourly series explicitly.
- Independent row creation already inserts membership with `attendance='attending'` in `supabase/migrations/202609120003_operations.sql`. Verify this behavior end to end before considering any backend changes.
- `shared/presentation.ts` intentionally exempts independent rows from attendance filtering in My rows. Scheduled rows needs its own multi-select semantics; do not accidentally change My rows behavior.

## Intended behavior

### Landing, filters, and selection

- An ordinary fresh launch lands on Forecasts → Scheduled rows. Explicit deep links and app-update restoration retain their intended destination; returning from background should not forcibly reset active work.
- Display Scheduled rows wherever the forecast destination is named. Prefer keeping the internal Rows ID with a separate display label to avoid invalidating saved resume payloads; otherwise provide compatibility mapping.
- Replace the Rows heading/subtitle with three native checkboxes in this order: **Attending**, **Unknown**, **Not attending**. Only Attending starts checked. Multiple checked values form a union; none checked means no matching cards.
- Keep the existing upcoming/in-progress time boundary and chronological ordering. Normalize unknown/missing practice attendance consistently. Independent rows belong to Attending; they disappear when Attending is unchecked.
- Preserve filters during navigation within the current app session; start a fresh session at Attending only. Keep a visible selected card selected. If filtering or refreshed data removes it, select the first remaining card; if none remain, show an appropriate empty state and no unrelated day chart.
- For an explicit “forecast this row” action, include the target's attendance category so the requested card can be selected. Do not silently substitute a different row.
- The chart day derives directly from the selected row's local date. It must not use Week's independently selected day or fall back to today when the row is beyond forecast coverage. Show an honest unavailable state for that row's date.
- With no scheduled rows, offer the existing scheduling action. With no filter matches, explain the filter state. Signed-out users get a concise sign-in state with access to Today and Week.

### Practice / scheduled-row cards

“Card” is the appropriate UI term; “scheduled-row card” includes practices and independent rows.

```text
Mon, Sep 21                         [Attending]
5:30 AM – 7:00 AM
Master Novice & Recreational
──────────────────────────────────────────────
[wind arrow]   7–8 mph • G20 • from NE
[weather icon] 54°F • Overcast • 6–19% rain
```

- Date, time, and title share font size, color, and weight. Date and attendance share the first line; allow long titles to wrap. Attendance is a text badge, not a nested interactive control.
- Keep selection visibly distinct and keyboard-operable. Prefer one card per row on phones so summaries have room; allow a grid at wider sizes.
- Reuse window summary semantics: sampled wind range, maximum gust, temperature range if it varies, weather description, and hourly rain-chance range. Do not turn varying temperature into an unexplained average or treat a rain-chance range as probability for the whole practice.
- Preserve variable-direction, missing-data, expired-data, and partial-coverage states concisely. Keep wind arrows' established direction convention and accessible descriptions.

### Content following cards

The sole forecast content after the cards is the full-day interactive chart. Remove the selected-row duplicate heading, sample explanation, short-window chart, vertical sample list, detailed-day disclosure, highlight checkbox, and day stepper from this tab. The selected row's window is always highlighted, clipped to the chart's day domain.

Remove assessment controls/results from this tab's rendering and avoid their now-unused fetches; retain the underlying assessment service. Move the “Planning another row?” scheduling affordance above the cards or rely on the existing scheduling entry point. Keep compact provider/update attribution and actual stale/error messages as utility metadata, not extra forecast panels.

### Full-day chart

- Show the selected day once in a compact header. Remove the large duplicate date and “Drag or use the time slider” text. The live inspection readout contains time only, wind/direction, secondary gust text, and a compact temperature/conditions/rain-chance line; no repeated date or timezone.
- Remove the visible range slider. Tap/click and horizontal drag inspect samples. Preserve vertical page scrolling, pointer capture/cancellation, and the existing frozen-data behavior during gestures. Make the inspection surface keyboard-focusable with arrow/Home/End controls and an accessible value description so removing the slider does not remove non-pointer access.
- Widen the plot by reducing nested horizontal padding, allowing the chart to extend toward mobile page edges, and using a compact right-side value gutter like the reference. Target an actual plot span of at least roughly 85% of the phone viewport at 375–430px, with legible labels and no page overflow. Keep header text padded independently of the plot. Use available desktop content width.
- Keep the complete local day visible without horizontal scrolling as the first design. Retain one wind arrow per hour; use simple compact glyphs, aligned to the time axis. Widen first and measure readability rather than silently removing hourly arrows. If the smallest supported width still cannot accommodate them, record the measured limitation for design review.
- Stack chart bands as: weather icons → wind direction icons → wind/gust curves → temperature → precipitation probability → time labels. Keep bands on one aligned time axis.
- Use black/charcoal wind and distinguishable gray/dashed gust curves with subtle neutral fills. Green remains available for the app's existing semantic statuses; do not encode wind curves with it.
- Remove overflow triangles. Replace the fixed 30 mph ceiling with a rounded, data-aware ceiling that includes all available wind and gust peaks (with a sensible baseline). This avoids silently clipping stronger winds after removing the indicators.
- Add faint vertical rulers at local clock times such as midnight, 6 AM, noon, and 6 PM, aligned across graph bands. Keep horizontal guides subtle. Handle 23/25-hour daylight-saving days correctly.
- Replace in/h with a 0–100% probability panel built from hourly probability intervals, preferably steps. Preserve null gaps and distinguish unknown from 0%. Do not invent quarter-hour probability points or interpolate across absent data. Keep all real quarter-hour wind/temperature points and existing ingestion/storage cadence.
- Keep cursor and selected-row highlight visually distinct. The live readout should stay stable in height during scrubbing. On selecting a row, initialize inspection at the closest available sample to its start; manual inspection then remains within its full day.

## Implementation checklist

### 1. Navigation, attendance, and selected-row state

- [x] Add display label and new default; update navigation, cross-view forecast actions, and accessible names.
- [x] Add multi-select attendance filtering and explicit selection/empty-state rules.
- [x] Decouple the scheduled chart day from Week's state and forecast-horizon fallback.
- [x] Verify independent-row creation persists Attending and displays it after reload; fix only demonstrated gaps.
- [x] Add behavior tests for default navigation, filter combinations, explicit row selection, and no matching rows.

### 2. Cards and page composition

- [x] Implement card structure, equal metadata typography, badge, divider, and compact weather lines.
- [x] Use a scheduled-card variant/component if needed so shared Week summaries are not inadvertently restyled.
- [x] Remove obsolete Scheduled rows panels, controls, and associated requests/state.
- [x] Render only the selected full-day chart after cards; make highlighting unconditional.
- [x] Verify short/long titles, independent rows, all attendance values, missing weather, and out-of-horizon dates.

### 3. Chart data and interaction

- [x] Provide the hourly probability series separately from merged high-resolution chart samples.
- [x] Implement interval-correct probability plotting, missing-data gaps, and live rain-chance lookup.
- [x] Replace overflow indicators with a data-aware wind/gust scale.
- [x] Remove the slider and add keyboard inspection to the chart surface.
- [x] Verify pointer/touch cancellation, page scrolling, refresh while dragging, and selection reset when switching cards (including two cards on the same day).

### 4. Chart visual layout

- [x] Reclaim horizontal plot space and measure mobile plot/viewport width.
- [x] Reorder weather/wind icon bands and preserve hourly arrows.
- [x] Add vertical rulers, neutral wind/gust styling, one date, and compact live readout.
- [x] Check highlights, axes, cursor, labels, and icons at mobile and desktop sizes.

### 5. Verification and handoff

- [x] Update obsolete browser assertions for Rows/Today defaults, sliders, detail lists, and overflow markers; keep coverage of the replacement behavior.
- [x] Extend `tests/presentation.test.ts` / `tests/timeline.test.ts` for filtering and probability intervals, including null versus zero, boundaries, partial coverage, and DST days.
- [x] Extend `tests/browser/pilot.spec.ts` for card-driven days, always-on highlight, filter fallback, typography, keyboard/touch inspection, missing-data states, and layout overflow.
- [x] Verify actual independent creation through existing database/integration coverage, adding a focused assertion if absent.
- [x] Run `npm run typecheck`, relevant Vitest suites, and affected Playwright suites using repository-supported configuration. Run the production build. Record commands and results below; do not claim suites passed if their required stack was unavailable.
- [x] Visually review approximately 320, 375/390, 430, 768, and 1280px widths; include a mobile WebKit pass and, when available, actual iPhone touch review. Document any device testing not performed.
- [x] Update this file with completed items, remaining issues, and implementation references. Deployment is a subsequent step, not part of this planning-only request.

## Continuation notes

### Deferred idea: show the chart beneath the selected card

Recorded 2026-09-20. **Deferred at the user's request; do not implement without a new request.** This is an optional future idea, not an unfinished implementation requirement. Keep the current chart behavior for now.

- Initially show only the scheduled-row cards, with no card selected and no chart visible. Selecting a card would reveal the full-day interactive chart directly beneath it. Omit the chart's date header because the card supplies the date.
- Keep only one chart mounted; selecting another card would move the chart. Tapping the selected card again to collapse it is an optional interaction, not a confirmed requirement.
- Feasibility: a small-to-moderate UI change using the existing selection and chart components. No backend or weather-fetching changes are expected. Rendering cost should remain similar, with less initial chart work while collapsed; weather fetching would still occur as it does today.
- Main layout decision: the phone's single-column cards make placement straightforward. For the desktop grid, a possible approach is a full-width chart beneath the grid row containing the selected card. This needs a design decision before implementation.
- Account for scroll position, keyboard focus, accessible expanded state, filter changes that hide the selected card, and explicit cross-view requests to forecast a row. Avoid unexpected page jumps when the chart opens or moves.

Both clarification questions are resolved. All five implementation and verification milestones are complete. Physical iPhone review has not been performed. Production deployment is complete. Useful files: `src/navigation.ts`, `src/App.tsx`, `src/ForecastView.tsx`, `src/ForecastRows.tsx`, `src/ForecastDayView.tsx`, `src/WeatherChart.tsx`, `src/WindowReading.tsx`, `src/WindReading.tsx`, `src/styles.css`, `shared/presentation.ts`, `shared/timeline.ts`, `shared/weather.ts`.

Implementation was merged through PR #37 and deployed as commit `a5cff222c496033ed7568ac1e1f44e3f94f9970c`. Independent creation already persisted Attending, so no database migration was necessary. The internal Rows destination ID remains compatible while its visible label is Scheduled rows.

The chart's SVG is keyboard-accessible with ARIA slider semantics, but there is no visible slider control. Hourly wind arrows use a fixed-length compact variant so their direction remains readable at phone widths. Other wind indicators retain their existing speed-dependent length.

Mobile plot width is viewport minus 54px: 321/375px (85.6%), 336/390px (86.2%), and 376/430px (87.4%). No horizontal page overflow was detected at 320, 375, 390, 430, 768, or 1280px. At 320px the checkbox group may wrap and the plot occupies 83.1%; all hourly arrows remain. Browser screenshots at these widths were reviewed, including mobile WebKit. Physical iPhone testing was not performed.

Validation evidence:

- `npm run build`: passed, including both TypeScript configurations. Vite reports its existing large-bundle advisory (about 622 kB before gzip); build succeeds.
- `npm test`: 75 tests passed across 11 files, including actual PostgreSQL/PGlite independent-creation membership verification, probability interval boundaries/null gaps, and DST-aligned chart rulers.
- `npx playwright test --reporter=line`: 34 passed, 2 intentionally skipped across desktop Chromium, mobile Chromium, and mobile WebKit. The CDP touch-gesture test runs only in mobile Chromium. Cross-view selection of a filtered-out practice is now covered and passes.
- Isolated `npm run test:stack`: 43 real-backend integration tests and 40 production browser journeys passed; 2 pre-existing platform-specific browser skips. The subsequent upgrade suite initially found two obsolete expectations for a wind image on the signed-out default page. Those assertions now verify the Scheduled rows sign-in state.
- `npm run test:stack -- --updates-only`: passed on the final frontend code, 8 upgrade tests passed and 2 existing WebKit offline/persistent-profile skips. The temporary stack was cleaned up successfully.
- `git diff --check`: passed.

Screenshots are reproducible through the scheduled-filters browser test, which writes `/tmp/mendocean-scheduled-<project>-<width>.png`. They are diagnostic artifacts, not required inputs for continuing this work.

## Change log and validation evidence

- 2026-09-19: Created plan from the latest request, both screenshot references, source inspection, and Open-Meteo documentation. Two optional scope/icon preferences are pending. All implementation items remain open.
- 2026-09-19: User confirmed removals apply only to Scheduled rows for now, and the conditions line uses a weather icon. Both clarification questions are resolved; implementation has not started.

- 2026-09-20: Implemented navigation/defaults, attendance filters, compact cards, and the single selected-row day chart. Added hourly probability plotting, clock-aligned rulers, neutral wind curves, a wider chart, compact readings, and keyboard inspection. Retained Today/Week content and data resolution. Added mobile WebKit coverage and fixed a cross-view filter/selection race found by the new tests. See validation evidence above.
- 2026-09-20: Completed the upgrade-suite rerun successfully. All checklist items are complete. No deployed services were changed.

- 2026-09-20: User requested access to test the changes in the live app. Publishing through the protected main-branch workflow. Updated CI to install WebKit and production smoke to check the new default landing page before verifying public weather.

- 2026-09-20: User explicitly authorized pushing, creating/merging the PR after checks, and deploying to mendocean.fyi. [PR #37](https://github.com/grahamfindlay/mendocean/pull/37) merged after both required checks passed (fast: 1m46s; full-stack: 4m19s). Release `a5cff222c496033ed7568ac1e1f44e3f94f9970c` is live. Exact-commit read-only production API/assets/Auth smoke passed, and the production browser smoke passed, including the Scheduled rows default, public weather navigation, and service-worker control. Workspace synchronized to main; this final release note is persisted locally.

- 2026-09-20 follow-up: User requested tighter inspection-stat spacing and less space above the chart, a Wind • mph panel title instead of the legend, and faint horizontal guides at every 10 mph with the existing adaptive axis. Implementing and deploying through the same approved release workflow.
- Follow-up validation: production build and six focused chart/browser cases passed across desktop Chromium, mobile Chromium, and mobile WebKit. Reviewed the compact phone layout and 10 mph rules.
- Follow-up release: PR #38 passed required fast (2m22s) and full-stack (4m57s) checks. Automatic approval review rejected the production merge, interpreting the previous deployment approval as limited to PR #37. Follow-up is ready; explicit approval for merging PR #38 is pending.

- 2026-09-20: User explicitly authorized merging and deploying PR #38. Merged as `84c3c858e7b8a479aa4249550af8bd961ae56a0c` and verified live at https://mendocean.fyi. Exact-commit production smoke and browser smoke passed. A read-only 390px browser check confirmed no legend, the Wind • mph title, guides at 0/10/20/30/40 mph for the current data, and compact stats (~107px high). Follow-up deployment is complete; workspace synchronized to main.

- 2026-09-20 page-spacing follow-up: User requested tighter space before the first card and explicitly requested merge/deploy. Reduced shared header/navigation padding and scheduled toolbar margins; on phones the accessible 44px scheduling action now sits beside the filters. The first card starts roughly 100px higher at 390px. Production build and nine focused Chromium/WebKit browser cases passed; mobile layout reviewed. Releasing through the protected PR workflow.

- 2026-09-20: Page-spacing follow-up deployed through PR #39 as `cbb8ee0d66242945f57b57c755265909d1062821`. Required fast (2m6s) and full-stack (4m28s) checks passed after making the layout assertion exclude the development-only notice and the gesture assertion independent of wall-clock sample indices. Exact-commit production smoke and production browser smoke passed. Workspace synchronized to main.


## Today redesign follow-up — 2026-09-20

The user now requests removal of Today’s short-window forecasts and 30-minute lists, superseding the earlier decision to retain them on Today. Week remains unchanged. The deferred idea of placing a chart directly under a selected card remains on hold.

- [x] Replace the oversized current-conditions panel with a compact panel titled Now; retain the actual sample timestamp in Weather details.
- [x] Reuse the scheduled-row cards and attendance filters for rows starting on today's America/Chicago calendar date, including rows earlier in the day. Omit the entire rows section when there are no rows today; show no empty-state message when filters hide all cards.
- [x] Show one full-day chart regardless of rows or filter matches; highlight the selected row when present. Selection changes the highlight without changing Today’s day or forcing inspection to another time.
- [x] Add a distinct labeled current-time line, independent of the inspection cursor and selected row. Keep it live during dragging; reset the day domain at local midnight. Render the day axis and clock marker even when weather samples are unavailable.
- [x] Remove Today’s short-window selector/chart, vertical sample list, and trailing logging callout. Existing top-level Log remains available.
- [x] Extract shared AttendanceFilters and ScheduledRowCards components to keep Today and Scheduled rows consistent without duplicating card rendering.
- [x] Complete final checks and release verification.

Validation: production build and 75 unit/database tests passed. Existing 34 browser cases passed (2 platform skips); three additional Today cases, including local-midnight rollover, passed across desktop Chromium, mobile Chromium, and mobile WebKit. Mobile Today layout visually reviewed. Physical iPhone testing was not performed.

Released through [PR #40](https://github.com/grahamfindlay/mendocean/pull/40) as `6b6571ed198ac4d097f05fd3969cf5b79e73075a`. Required fast (2m25s) and full-stack (4m28s) checks passed. Exact-commit read-only production smoke and production browser smoke passed. A live 390px browser check confirmed the Now panel is about 133px tall, one full-day chart and one independent current-time marker are present, the row section is absent without rows, and there is no horizontal overflow. Workspace synchronized to main; this final release note is persisted locally.


## Today label cleanup — 2026-09-20

User requested removal of the Now card’s Weather details/sample disclosure and the visible All day chart header, followed by merge and deployment. Removed the disclosure and its dedicated styles. Today hides the chart title while retaining its accessible region name; other chart titles remain unchanged. Production build and nine focused browser cases passed across desktop Chromium, mobile Chromium, and mobile WebKit. Released through PR #41 as `22ad4f7f05e214f57016009bc57e44a81bd41335`. Required fast (2m26s) and full-stack (4m41s) checks passed. Exact-commit production smoke passed; a live 390px browser check confirmed both requested elements are absent and the current-time chart remains visible. Workspace synchronized to main; final release evidence persisted locally.


## Wind-color explanation — 2026-09-20

Update the disclosure to “Wind colors: Hannah’s heuristic v1.0.0”, capitalize Bussin’, Sus, and Chopped, and use the user’s requested speed/direction and future-model explanation. Include a compact wind rose inspired by Hannah’s public dashboard, using the existing windStatus rule and exact sector boundaries, with accessible threshold descriptions and a source link. Render locally as SVG without a charting dependency or runtime fetch. Production build and three existing public-forecast browser checks passed across Chromium and WebKit. Expanded 390px layout visually reviewed with no horizontal overflow; exact disclosure and key labels verified. Released through PR #42 as `ce9e2be53538b5a39b41d4fc521196bac42377d4`. Fast passed (2m9s). Initial full-stack run failed in an unrelated push-notification browser assertion; rerun passed (4m52s) without code or test changes. Exact-commit production smoke passed, and the live 390px disclosure, labels, paragraph, and wind rose were verified. Workspace synchronized to main; final release evidence persisted locally.


## Filled wind key — 2026-09-20

Replace the three outline legend symbols with filled circle, triangle, and diamond symbols, preserving labels and colors. Production build passed. PR #43 merged and deployed as `2328f4bdb02e0cd43fd4d1a74f607bea45f3cfc6` after required fast (2m20s) and full-stack (4m24s) checks passed. Exact-commit production smoke and live filled-symbol verification passed. Workspace synchronized to main; final release evidence persisted locally.


## Week card consistency — 2026-09-20

Week day cards now use the Scheduled rows responsive grid (one full-width card on phones), card surfaces, selected state, metadata typography, and shared two-line wind/weather summaries. Morning and evening windows remain within each day card; the whole card selects the day. Shared WindowReading rendering avoids divergence between Week and Scheduled rows. Production build and six focused browser cases passed across desktop/mobile Chromium and mobile WebKit, including mobile card width and selection. Reviewed a 390px screenshot: card and grid both 350px wide, no page overflow. Released through PR #44 as `26bfee53d34afd4e7d6ae97a6a286eb2f96a00fd`. Required fast (2m21s) and full-stack (5m18s) checks passed. Exact-commit production smoke and live 390px card-width/selection verification passed. Workspace synchronized to main; final release evidence persisted locally.


## Configurable Week times of interest — 2026-09-20

User confirmed periods repeat every day and requested implementation. Add an expandable Times of interest editor above Week cards, enabled Early morning (05:30–07:30) and Evening (18:00–20:00) defaults, per-period visibility, edit/remove, and custom labeled periods. Sort enabled periods chronologically on every card. Same-day periods use Madison local time; overlapping windows are allowed. Limit 12 periods and 40-character names. An empty selection keeps day selection/chart available.

Signed-out preferences persist locally. Signed-in preferences persist per account in a nullable profiles.week_periods JSON field via authenticated GET/POST week-periods; null selects defaults, [] intentionally selects no periods. Existing profile RLS remains in place, API updates only the authenticated user's field, and unrelated account/reminder settings remain unchanged. Validate payloads on client and server. Load failures block editing until retry; save failures preserve prior choices and the draft. Account changes remount preference state; no cross-account local cache.

Use existing forecast-window summaries for arbitrary local times. Ambiguous or nonexistent DST bounds produce unavailable summaries rather than guessing or crashing. Shared version of the default periods renames Morning to Early morning. Required production order: additive migration and API deployment before frontend merge/release. Validation: production build, 77 unit/database tests, six focused browser cases, and final three editor cases pass. Final isolated stack passed 44 backend tests, 43 production browser journeys (2 existing skips), and 8 upgrade tests (2 existing WebKit skips). The new failed-request test explicitly blocks service workers to ensure WebKit honors request interception. Mobile editor reviewed. Hosted migration dry run lists only 202609200001_week_periods.sql. Released through PR #45 as `7f0d046bdaee87285e770177da61e28e2b785091`. Required fast (2m37s) and full-stack (4m45s) checks passed. Applied the single additive migration and deployed the api function successfully before frontend merge. Exact-commit production smoke passed. Live 390px signed-out browser verified defaults, adding a period on every day, local persistence after reopening Week, and no overflow; no production account preferences were modified during verification. Cross-device signed-in persistence and failure recovery were verified against the isolated real backend. Workspace synchronized to main; final release evidence persisted locally.


## Shorter default periods — 2026-09-20

Requested defaults: Early morning 05:30–07:00 and Evening 18:00–19:30. Change default definitions without overwriting existing saved preferences, since periods are now editable personal choices. Production build, 77 unit/database tests, and six focused browser cases passed. Release pending.

Future idea (not requested for implementation): optional weekday selection inside each period editor. Default all seven days for existing/new periods; allow multiple weekdays and quick Every day / Weekdays / Weekends choices. Keep visibility independent from day eligibility. Apply only eligible enabled periods to each local calendar date, leaving the day chart available when none match. Display a concise day summary alongside each saved period.
