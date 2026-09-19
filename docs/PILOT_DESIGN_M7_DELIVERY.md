# Round 2, milestone 3 (M7): Forecasts — Today, Week and Rows

Implemented September 19, 2026. Scope: R06, R16, R17, R19, R21, R22, R24 and
the entry-point half of R25 in `PILOT_DESIGN_ROUND2_PLAN.md`. R20 is superseded
and R23 is dropped; both are recorded in the plan. No database migration, no new
service and no change to weather collection cadence.

## Behavior

- User-facing text says row and rows everywhere: navigation, headings, forms,
  empty states, validation messages, reminder explanations, accessibility labels
  and the logging reminder email. Internal names are deliberately unchanged —
  the `outings` table and columns, `outing_id`, the `outing`/`outings/*` API
  paths and payload keys, `outingSchema`, `outingPhase`, `canLog`,
  `sortedOutings`, `OutingsView` and the `/?log=` deep link all keep their
  spelling, as do the `outing-*` CSS classes.
- Forecasts is one top-level destination opening Today, with a second row for
  Today, Week and Rows. Log and My rows remain top level. The sub-row renders
  only on a forecast destination, and selecting Forecasts returns to Today. One
  destination table in `src/navigation.ts` drives the navigation, the forecast
  predicate and the resume whitelist, which previously repeated the same names
  in three places. `/?log=<id>` and `/?account=1` are unchanged, since both are
  generated server-side. `?tab=` now accepts any destination by name; the
  `?tab=Plan` alias and the hardcoded legacy tab names are deleted rather than
  extended. The calendar-day chart is retitled **All day** so the page no longer
  renders a heading and a subheading both reading Today.
- Week leads with seven day cards, including today whether or not its windows
  have passed. Each card carries a morning (05:30–07:30) and an evening
  (18:00–20:00) summary from `PRACTICE_WINDOWS` in `shared/domain.ts`, with
  bounds derived through `chicagoToISO` so DST days are handled and a window
  that straddles a changed hour degrades rather than throwing. Real BHC practice
  times are a later refinement. The day row gains Earlier and Later arrow
  controls outside the day selector and scrolls the selected day into view.
- One shared summary serves Week cards, scheduled-row forecasts and M8's
  compact cards. `summarizeWindow(weather, start, end)` reports sampled wind
  min–max, peak gust, temperature range, a circular bearing with a `variable`
  flag, the worst applicable classification, a rain-probability range and
  explicit coverage. It reports extremes and never means: a window mixes 15- and
  60-minute samples, so an unweighted average would weight the near term about
  four to one. Coverage comes from `windowSamples`, so a gapped or
  out-of-horizon interval stays visibly incomplete and no distant sample is
  recruited to complete it. A 0% rain chance stays distinct from an absent one,
  and probability is read from `weather.hours` on the provider's
  `(t − 1h, t]` convention.
- Rows lists upcoming rows soonest first, each card summarizing its whole
  scheduled duration, drawn from the same `account.outings` dataset as My rows
  so the two cannot drift. Selecting a card inspects that row's window and
  shows its day. The learned-assessment surface is preserved behind its existing
  capability gates — `capabilities`, `contexts`, the basis selector and the
  fitted-results block are unchanged; only the instant's source moved from a
  text field to the selected row. With nothing scheduled there is no instant to
  assess, so that surface is not shown. Signed out, Rows explains account access
  while Today and Week stay public.
- A **Show this row on the day chart** toggle marks the selected row's window on
  the day chart. The band is drawn behind the series, clamped to the plotted
  domain, and carries `pointer-events: none` so the inspection cursor remains
  the only thing the surface reacts to. It uses the same scale and bounds as the
  axes, so it cannot disagree with them during a gesture.
- My rows offers **Schedule independent row** and **Log independent row** as
  separate actions. Labelling and routing only: both reach workflows that
  already existed, and scheduling remains available without a BHC account.

`ForecastView.tsx` was split before this content was added to it: 672 lines
branching across three destinations became a 150-line shell holding the state
that survives moving between destinations, plus `ForecastToday`, `ForecastRows`,
`ForecastDayView`, `WindowReading` and `HourRow`.

## Decisions recorded

**R20 is superseded.** It asked for Week's start time and Duration controls
behind a Change time disclosure. Those controls existed because the cards were
keyed to a chosen instant; with fixed practice windows on Week and scheduled
durations on Rows, there is no arbitrary time left to change in either view. The
requirement is satisfied by removal rather than by a disclosure.

**R23 is dropped**, as the plan permits. It was written for a free-form planner
where dragging a highlight boundary changed a number in a text field. The window
now belongs to a scheduled row, so dragging its edge would mean rescheduling
that row from a chart — write semantics, conflict handling and an undo story.
That is a larger feature and deserves its own proposal rather than landing as
the last increment of this milestone.

## Concurrent work, outside M7 scope

The update coordination layer was retired during this milestone and is recorded
separately in `UPDATE_SIMPLIFICATION_PROPOSAL.md` and in the withdrawal section
of `PILOT_DESIGN_M5_DELIVERY.md`. It shares no code with the forecast work.

## Verification

Local checks across the milestone: 73 unit tests, TypeScript and Vite builds, 17
preview browser cases with the existing desktop touch exclusion, 43 integration
tests and 40 production browser journeys. Both `fast` and `full-stack` passed on
every merged pull request. The `Workers Builds: mendocean` check fails on every
commit and is ignored: no Cloudflare Worker exists in this repository.

New regression coverage pins the parts whose guarantees are not visible in a
rendered card: extremes surviving a 15-minute spike among calm hours, one bad
quarter-hour making a whole window unfavorable, gapped and out-of-horizon
windows staying uncovered, 0% staying distinct from absent, circular bearing
averaging, a scheduled row's own window and its quarter-hour bracketing, and the
highlight band's placement — verified to fail when offset by two hours — its
width for a one-minute row, and its transparency to the inspection gesture.

Checked against live Open-Meteo data rather than fixtures: seven days returned,
days three through seven hourly with no quarter-hour samples yet reporting
complete coverage from bracketing hourly ones, rain probability present on
quarter-hour days, and morning and evening statuses genuinely differing within a
day — September 18 read favorable in the morning and unfavorable in the evening.
That difference is the reason the interval changed from a calendar day to a
practice window: the whole day read unfavorable because of afternoon wind at a
time nobody is on the water.

Deployed at `eddddee`, confirmed by exact-commit production smoke checks. The
seven-day cards and scheduled-row forecasts were walked on the live site at
phone width, which is how the wrapping time range in #23 was found. The owner
confirmed the installed iPhone app on this release.

### Two defects the suites did not catch on their own

A phone-only layout failure reached production: seven 160px day cards in one
row make the document about 1120px wide, and a phone answers that by widening
the layout viewport and zooming the page out to roughly a third. The existing
`scrollWidth <= innerWidth` guard was satisfied by the zoom-out. The cards now
wrap, and the guard asserts `innerWidth` equals the viewport width, verified to
fail without the fix.

The assessment endpoint returned `400 Invalid ISO datetime` because Postgres
returns `starts_at` with a `+00:00` offset while the endpoint's schema accepts
only a `Z` suffix. The preview suite cannot catch this class of defect — it
never reaches a real endpoint — so it appeared only in `full-stack`.
