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

The reserved fictional practice routes attendance status, explicit test saves and roster reads through the separately guarded staging-test function. This requires the exact staging backend/environment, the sole owner's session, outing membership and the reserved synthetic identifiers. These frontend adapters are excluded from production builds. The test roster uses the current fictional crew plus an unassigned attendee, a declined rower and an unknown rower. Opening or refreshing it does not reset the owner's lineup, attendance or notification preferences. Explicit test saves update only the fictional membership and never call BHC or create notifications.

`npm run staging -- attendance-smoke` checks roster access, the hosted modal and refresh in mobile Chromium/WebKit, including 320/390/430-pixel widths. It sends no login email, changes no practice state, never saves attendance, and signs out only its own generated test session. It compares memberships, snapshots, preferences and event counts before and after. Unlike the existing scenario smoke, it does not reset/publish fixtures and can run with lineup notification preferences enabled. The screenshots contain only the fictional roster.

## Local validation

Passed: 173 unit/database tests, 66 isolated backend integration tests, nine production-build attendance browser cases across Chromium/WebKit/mobile Chromium, three existing attendance-badge preview cases, eight service-worker upgrade cases (two existing WebKit platform exclusions), 14 Python tests, TypeScript/Deno checks, and a production build. Production output was checked to exclude the staging attendance adapter and its fictional-save controls. Browser coverage includes lazy loading, collapse/reopen, alphabetical names, empty responses, retry, independent attendance saving during roster failure, keyboard opening/focus return, and preserving forecast selection.
