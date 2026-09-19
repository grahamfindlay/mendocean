# Proposal: retire the update coordination layer

Status: **proposal, not decided.** Nothing here is implemented. It walks back
part of milestone 5 (`PILOT_DESIGN_M5_DELIVERY.md`), so it needs an explicit
decision before any code moves.

## The question

M5 built a system for applying an update without disturbing someone who is
mid-task. It works. The question is whether what it protects is worth what it
costs, now that the operating conditions are known: one user, who has said
brief downtime is acceptable.

## What exists today

| File                              | Lines | Role                                                        |
| --------------------------------- | ----- | ----------------------------------------------------------- |
| `src/appUpdates.ts`               | 340   | Check, offer, coordinate, reload                            |
| `public/sw.js`                    | 197   | Offline shell, release verification, update handshake, push |
| `src/updateSafety.ts`             | 73    | Block reasons, `inert` lock, write/save tracking            |
| `src/UpdateControls.tsx`          | 59    | Banner and Account settings                                 |
| `tests/updates/lifecycle.spec.ts` | 556   | Eight real-worker upgrade journeys                          |
| `tests/support/legacy-sw.js`      | 104   | A stand-in for the pre-M5 worker                            |

Plus the harness in `scripts/test-stack.mjs`, which builds three app versions
(`dist-a`, `dist-legacy`, `dist-b`) and runs a release server purely to
exercise upgrades.

For comparison, the entire application source is about 4,990 lines.
`lifecycle.spec.ts` is the largest test file in the repository.

## What it actually protects

Two distinct things are tangled together under "update safety". Separating them
is the whole of this proposal.

**Release integrity — keep.** The worker downloads every asset, checks each
SHA-256 against the manifest, and installs only if all of them verify. A
partial or mixed release never replaces a working shell. This is what stops a
half-downloaded update from bricking an installed app, and on an installed iOS
app that matters more than in a tab: there is no address bar, no reload button,
no way to clear site data. Recovery is delete-and-reinstall. `lifecycle.spec.ts:288`
covers it.

**Work-in-progress coordination — the subject of this proposal.** Before
activating, the worker asks every open window whether it is safe. Any window
that says no cancels the update for all of them. A page blocks when:

```js
tab === "Log" ||
  tab === "Rows" ||
  authOpen ||
  settings ||
  planned ||
  attendanceOuting;
```

Note what that condition is not. It is not "you have unsaved typing". Merely
_being on_ Log or Rows blocks updates, regardless of whether anything has been
entered. Much of the time the app is in use, updates are blocked by
construction.

## What is underneath it

Drafts autosave to IndexedDB on a 350ms debounce and restore on next load —
the "Your unfinished draft was restored from this device" notice in
`Logger.tsx`. Submissions that fail go to the outbox and retry.

So the exposure if a reload lands at the worst possible moment is: the last
≤350ms of typing, and an in-flight request that the outbox would re-send.

## Cost

Merge friction is the recurring cost, and it is not hypothetical:

- PR #19 needed three CI runs to go green. Two reds were update-lifecycle
  tests unrelated to the change being merged.
- `main` at `4340155` is red from `lifecycle.spec.ts:520`, after passing on its
  own PR.
- The `lifecycle.spec.ts:222` investigation earlier in M7 was the longest
  single debugging episode of the milestone and **no mechanism was ever
  found**. The fix — keeping the forecast sub-nav mounted and hidden rather
  than conditionally mounted — was established empirically.

That last point deserves weight. `:222` fails with the draft textarea present
in the DOM holding the right text, but not visible, because the `<details>`
around it has closed: the tab remounted. If that can happen under test, the
"another tab's unfinished work is protected" guarantee is leakier than its name
suggests. The coordination layer is both expensive and not fully delivering.

CI time, from a representative `full-stack` run (4m53s total): integration 14s,
production journeys 1m39s, upgrade journeys 51s, the remainder build and
harness setup that exists mostly for the upgrade lane.

## Proposal

**Keep:**

- The service worker, the offline shell, and the cache generations that keep an
  older open page's assets available.
- SHA-256 release verification and complete-or-nothing install.
- Push handling (`push`, `notificationclick`) — unrelated to updates.
- Checking for updates on launch, on returning to the foreground, on
  reconnect, and every five minutes while visible.
- The **Update available** banner and the Account → **Check for updates**
  control, so the app can never be stranded on a stale cached version.

**Remove:**

- `src/updateSafety.ts` entirely: block reasons, the `inert` lock, and the
  `protectWork` / `protectLocalSave` wrappers in `client.ts` and `outbox.ts`.
  Those wrappers only feed the pending-writes counter; the calls they wrap keep
  working unchanged.
- The `PREPARE_UPDATE` / `CANCEL_UPDATE` / `COMMIT_UPDATE` handshake in
  `sw.js` and its counterpart in `appUpdates.ts`.
- Reload orchestration: `reloadFor`, `intended`, `intendedWorker`, the bounded
  retry, and the auto-apply-at-entry path.
- The legacy-worker bootstrap path and `tests/support/legacy-sw.js`.

**Becomes:** the banner appears, **Update now** is always enabled, pressing it
calls `skipWaiting()` and reloads. From the user's seat the happy path is
unchanged; what disappears is the greyed-out button and its explanation.

Estimated removal: roughly 900–1,000 of the 1,329 lines, with `sw.js` keeping
its install/fetch/push halves.

## What is given up

1. **In-flight writes.** A reload can land mid-submission. The outbox re-sends,
   so this is a retry rather than a loss — **worth verifying before relying on
   it.**
2. **Cross-tab coordination.** A second window's open form no longer holds back
   an update.
3. **The single-reload guarantee** (`lifecycle.spec.ts:520`). Today, tapping a
   link while a new version is waiting produces exactly one page load. Without
   the orchestration you may see the page load and then reload itself a moment
   later, losing scroll position. Cosmetic, but visible.

## Tests

Of the eight upgrade journeys, four survive roughly as-is and four go with the
behaviour they cover:

| Test                                                                  | Fate                                   |
| --------------------------------------------------------------------- | -------------------------------------- |
| `:180` first install, A→B→C, no reload loop, offline shell            | Keep                                   |
| `:288` corrupt asset retains old shell                                | Keep — release integrity               |
| `:329` ready update preserves an offline report, uploads once         | Keep — this is the real data guarantee |
| `:482` persistent profile upgrades on reopen, retains sign-in offline | Keep                                   |
| `:222` manual upgrade waits for another tab's draft                   | Remove                                 |
| `:369` existing-report edit untouched by an update during use         | Remove                                 |
| `:428` attendance submission finishes before activation               | Remove                                 |
| `:520` legacy worker, no extra reload                                 | Remove with the legacy path            |

Added in exchange: a test that a reload mid-draft restores the draft, which is
the guarantee actually being relied on afterwards and is currently implicit.

## Recommendation

Do it, but after M7. Steps 6 and 7 are in flight and the split is fresh;
pivoting now means carrying two half-finished changes. The friction is real but
survivable for two more steps, and doing this while nothing else is open makes
the deletion reviewable.

One thing not to do quietly: this removes a guarantee M5 made deliberately and
documented. `PILOT_DESIGN_M5_DELIVERY.md` should be amended to record what was
withdrawn and why, rather than left describing behaviour the app no longer has.
