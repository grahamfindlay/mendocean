# Other practice attendees

Tapping a BHC practice's attendance indicator opens the existing Practice attendance modal. Its final section, **Who else is attending**, starts collapsed. Expanding it reads the current BHC signup roster, shows an alphabetical name list and count excluding the viewer, and records the check time. Refresh attendees checks again; collapsing and reopening retains the modal's current result. Closing the modal clears it.

Only explicit `attendance_plan=Attending` entries appear, including people without boat assignments and without Mendocean accounts. The list is independent of lineup publication. Unknown and declined entries are excluded. Names are projected from `fname`/`lname` and deduplicated by BHC customer ID. Boat assignments, contact details, survey answers and other provider fields never enter this response. Existing published-lineup gates remain in place.

`bhc/attendance-roster` accepts only an outing ID. It checks authenticated, approved outing membership, current BHC identity/club access, practice availability and the connection revision after the provider read. Independent outings are rejected. The response is private and `no-store`; names stay in modal memory rather than local storage or the offline cache. Missing/malformed rosters are errors, distinct from a successful empty roster. Loading, retry, offline and reconnect states belong to the roster section, so roster failures do not disable attendance changes. Reads do not change attendance or enqueue imports, publication events or notifications.

## Provider observations — October 8, 2026

A deliberate read-only check used the owner's existing encrypted connection, decrypted only in memory. No attendance, lineup, application or notification changes were made, and only counts/field diagnostics were printed. The account's ordinary-rower permissions were previously confirmed in [LINEUPS.md](LINEUPS.md).

All eight available upcoming practices had viewer status Unknown. A published practice returned nine roster entries, seven marked Attending with names. An unpublished practice returned seven entries, six marked Attending with names; all six lacked boat assignments. This establishes visibility before lineup publication and with an undecided viewer. Visibility when the viewer is declined is covered by synthetic tests but was not observed live, because no such upcoming practice was available; no real attendance was changed to manufacture one.

To repeat the bounded read-only check, supply `BHC_CONTRACT_TOKEN` through the process environment and run `node scripts/bhc-attendance-contract.mjs` under Node 24. Optional `BHC_CONTRACT_CLUB_ID` selects a verified membership. The script makes at most six GET requests and prints only counts and normalized statuses.

## Staging

Follow [STAGING.md](STAGING.md). No feature-specific database migration is needed. Deploy compatible `api`/`jobs`, the staging-only `staging-test` function, and the frontend. Apply any missing baseline migrations first.

The reserved fictional practices route attendance status, explicit test saves and roster reads through the separately guarded staging-test function. This requires the exact staging backend/environment, the sole owner's session, outing membership and the reserved synthetic identifiers. These frontend adapters are excluded from production builds. The roster comes from a dedicated fictional signup response with `lineups_set=No` and no boat/seat fields; it never reads the saved lineup. Explicit test saves update only the fictional membership and never call BHC or create notifications.

Run `npm run staging -- attendance-fixture` to prepare **Upcoming attendance test** independently of the existing lineup scenario. It starts two days later at 7:30 a.m. Chicago time, with a signup deadline at 6 p.m. the previous day. The viewer starts Unknown; four other people are Attending, one is declined and one is Unknown. No lineup snapshot or publication event exists for this practice. Repeating setup advances its dates and preserves the viewer's choice. Setup checks that the existing practice, connection, lineups, notification preferences and event count remain unchanged; no notification is generated.

`npm run staging -- attendance-smoke` targets this specific practice and refuses to pass unless its start and deadline are in the future and its lineup snapshot/event counts are zero. It checks enabled attendance controls, roster access, lazy loading and refresh in mobile Chromium/WebKit, including 320/390/430-pixel widths. It sends no login email, changes no practice state, never saves attendance, and signs out only its own generated test session. It compares memberships, snapshots, preferences and event counts before and after. Unlike the existing scenario smoke, it does not reset/publish fixtures and can run with lineup notification preferences enabled. The screenshots contain only the fictional roster.

## Local validation

Passed: 173 unit/database tests, 66 isolated backend integration tests, nine production-build attendance browser cases across Chromium/WebKit/mobile Chromium, three existing attendance-badge preview cases, eight service-worker upgrade cases (two existing WebKit platform exclusions), 14 Python tests, TypeScript/Deno checks, and a production build. Production output was checked to exclude the staging attendance adapter and its fictional-save controls. Browser coverage includes lazy loading, collapse/reopen, alphabetical names, empty responses, retry, independent attendance saving during roster failure, keyboard opening/focus return, and preserving forecast selection.

## Hosted staging validation — October 8, 2026

Deployed source revision `4142002f4ebcc71945767774f0600310f5c90aa8`, build `4142002f4ebcc71945767774f0600310f5c90aa8-f114d1c6`, to [Mendocean Test](https://mendocean-staging.pages.dev). The missing baseline migration `202610080001_weather_observations.sql` was applied before deploying compatible api/jobs, staging-test and frontend builds. No feature-specific migration or fixture reset was needed.

Hosted checks verified all ten precache hashes, staging identity, closed signup and anonymous denial. The roster endpoint rejected anonymous sessions, unrelated outing IDs and attempts to attach a change to the roster read. Mobile Chromium and WebKit passed expansion, refresh and modal layout checks at 320/390/430 pixels. Both screenshots were visually inspected. Before/after reads confirmed identical attendance/reminder memberships, lineup snapshots/versions, notification preferences and publication-event counts. No login email or notifications were sent by the checks. The owner's existing two enabled notification channels were preserved. Production was not deployed by this task.

This initial hosted example used a published practice after its signup deadline and derived most fictional names from the saved lineup. It did not demonstrate the primary pre-publication use case. The separate open-signup fixture above replaces that example for attendance validation. The production endpoint itself has always read BHC practice attendance directly, without reading lineup snapshots. The isolated production-API regression now also checks changing signup responses while snapshot/event tables remain empty.
