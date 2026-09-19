# Installed-app updates — round 2, milestone 5

This is the first milestone of `PILOT_DESIGN_ROUND2_PLAN.md`. Later weather, chart and navigation changes are not part of this release. In particular, quarter-hour weather collection and chart points are unchanged.

## Withdrawn, 2026-09-19

The work-in-progress coordination described under **Behavior** was removed; see
`UPDATE_SIMPLIFICATION_PROPOSAL.md`. Open forms no longer defer activation,
another tab's unfinished work no longer blocks it, requests and local saves no
longer hold it back, and **Update now** is never disabled. Roughly 900 lines
went with it, including `src/updateSafety.ts`, the worker's
`PREPARE_UPDATE`/`CANCEL_UPDATE`/`COMMIT_UPDATE` handshake, the reload
orchestration and the legacy-worker bootstrap path.

What that protected is now carried by autosave: new-report drafts persist to
IndexedDB on a 350ms debounce and are restored on the next load, so an update
landing at the worst moment costs at most the last fraction of a second of
typing. Queued reports still upload exactly once after reconnecting.

Everything under **Release integrity** stands and is unchanged. So does
automatic application at a launch or foreground boundary; only its safety gate
was removed.

Given up deliberately: an in-flight request can be interrupted by the reload
(the outbox re-sends it), a second window's open form no longer holds an update
back, and a page on a pre-M5 worker no longer has a dedicated upgrade path.

## Behavior

The app checks for releases on launch, returning to the foreground, reconnecting, and every five minutes while visible. Ordinary checks are deduplicated and throttled to once a minute. Account offers **Check for updates** and a collapsed **App version**. A complete new release produces an **Update available** notice for signed-in and public forecast users.

A release may apply automatically at a safe launch/foreground boundary. During use, choose **Update now**. Open forms conservatively defer activation, including Log, Forecast, Account, sign-in, independent scheduling, attendance and administration. Finish/close Account after a manual check to use the global update action. Requests and local saves also defer updates. Another open tab with unfinished work blocks activation rather than losing its work.

New-report drafts flush on leaving the editor, including the last keystroke before the normal debounce fires. Saved reports are not recreated as drafts. Updates preserve local auth, IndexedDB drafts/outbox, backend BHC connections, the worker registration and push subscriptions. Navigation selections are retained across coordinated reloads. Existing-report edits remain protected by deferring updates while the editor is open.

## Release integrity

Each build has a shared identity in its HTML, JavaScript, worker and `build.json`; the latter retains its existing `commit` field. `/sw.js`, manifest ID, start URL and scope remain stable. A worker stages and SHA-256 verifies every precached file before it becomes ready. HTML and assets stay together as a complete offline shell. A failed/mixed release never replaces a working shell. Personal APIs and auth responses are not cached.

Activation uses client messaging, then reloads only after the intended worker controls the page. Reload attempts are bounded per build. Current, recently used and live-client caches are retained; only obsolete Mendocean shell caches are eligible for cleanup. An unknown/suspended client prevents premature cache removal. No user storage, auth token or push registration is cleared.

## Verification and rollout

The implementation shipped in [PR #7](https://github.com/grahamfindlay/mendocean/pull/7), commit `867d321`, after both required CI lanes passed. Live checks confirmed matching release hashes, public endpoints and successful worker installation/control. A final header audit found the custom domain rewriting the worker's `no-cache` header to a four-hour browser TTL, while Pages itself preserved it. The follow-up uses `no-store` for `/sw.js` and requires it in production smoke checks. This changes HTTP caching of the worker script, not the installed worker or its complete offline app-shell cache.

Production build/type checks, 61 focused tests, 8 Python tests and 14 preview browser cases pass locally. The complete disposable stack also passes 43 integration tests, 40 existing browser journeys and 14 real-worker upgrade cases. Each browser lane has two documented exclusions; Chromium covers offline upgrades, while online upgrades run in Chromium and WebKit. The real installed iPhone check is still required before claiming that the reported device symptom is resolved.

The production smoke checks verify the exact deployment commit, HTML/worker identity and every precache file's hash, then confirm the worker actually installs and controls a browser. These checks also retain the existing public forecast, Auth configuration and unsigned-write rejection coverage.

The old running JavaScript cannot acquire the new update coordinator without a first reload. Finish any unsaved work, then tap the mendocean header link for an online navigation or fully close/reopen the existing installed app. Do not delete/reinstall. Open Account → App version to confirm the new release. A later release can then exercise the new update path in that same installation.

For device acceptance: retain an unfinished report, return to forecasts, receive/apply a subsequent release, confirm login and the recovered draft, then reopen offline. Confirm push remains enabled; optionally use the existing test notification control. Desktop WebKit and mobile viewport emulation are not a substitute for this check.
