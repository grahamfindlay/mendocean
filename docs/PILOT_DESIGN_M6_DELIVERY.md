# Round 2, milestone 2 (M6): Readable weather and Today

Implemented September 17, 2026. Scope: R04–R05, R07–R15 and R18 in `PILOT_DESIGN_ROUND2_PLAN.md`.

## Behavior

- Current weather has a downwind arrow cap, compact sample-time disclosure, condition text and hourly rain chance with its actual interval. Numeric bearings, the location heading and cumulative precipitation amounts are removed from this card. Stale/error notices remain.
- Near-term and expanded daily summaries select half-hour timestamps, retaining hourly fallback. Collection, archives, model inputs and chart data still retain every available quarter-hour sample. Minute-specific targeted forecasts keep their actual bracketing samples.
- Hourly rain probability is associated with the provider's preceding-hour interval `(end − 1 hour, end]`. Missing probability remains unavailable; zero remains 0%. Expanded rows no longer repeat gusts or display accumulation amounts.
- A full Madison-calendar-day Today chart follows the near-term list. Its initial reading is the latest available sample at or before now. A second chart offers 2–24 hours, default 4, with an axis beginning at actual now. Source timestamps are preserved, including boundary context. Calendar-day bounds respect 23/25-hour DST days.
- Shared charts support pointer/touch inspection and the keyboard slider. Domain/data changes pause during a pointer gesture, then resume without discarding the selected timestamp. Vertical touch scrolling and cancellation remain supported.
- Readings appear above the plots; selected precipitation and the resolution footer are omitted. Wind/gust axes are fixed at 0–30 mph, with clipping, upward overflow markers and exact readings above that limit. Curves keep all source points and break at missing values or intervals.
- Wind vectors show downwind direction, restrained magnitude and heuristic color. Calm/missing states are explicit. Weather icons and wind annotations are spaced for the available width, independently of data density. The expanded heuristic key reads bussin’, sus and chopped.

Navigation is intentionally unchanged in M6. Forecasts → Today/Week/Rows, seven-day summaries and window highlighting belong to M7. No database migration, backend deployment or new service is required.

## Verification

Local checks: 65 unit/database tests, 8 Python tests, TypeScript/Vite build and Deno API/jobs checks passed. Production stack: 43 integration tests and 40 browser journeys passed, with two existing persistent-profile exclusions outside desktop Chromium. All 14 service-worker upgrade cases passed, with two documented WebKit exclusions. All 15 preview browser cases passed, with the desktop touch case intentionally excluded.

Preview regression covers actual quarter-hour chart density, half-hour lists, honest timestamps and rain intervals, fixed-axis gust overflow, arrow sizing/direction, keyboard/mouse inspection, frozen domains during dragging, and native Chromium touch input including cancellation and vertical page scrolling. The touch case runs only in the phone project; it is intentionally skipped in desktop configuration. Phone and desktop screenshots were inspected with synthetic varying weather, including gusts over 30 mph.

The protected PR must pass both fast and full-stack checks. After deployment, run exact-commit public smoke and production browser smoke. This release also provides the next opportunity to verify M5 on the owner's existing iPhone installation: receive the update, retain login/draft/push registration and reopen offline. The owner confirmed the preceding installed version as `8e62066`; desktop WebKit and mobile emulation do not establish actual iOS suspension or push continuity.
