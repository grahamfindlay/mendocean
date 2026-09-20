# Round 2, milestone 4 (M8): Compact My rows

Implemented September 19, 2026. Scope: R26–R31 in `PILOT_DESIGN_ROUND2_PLAN.md`.
R25 was completed in M7, where its entry-point half was pulled forward. No
database migration, no new service and no change to weather collection cadence:
M8 is presentation and filtering over data the client already holds.

Sequenced as the plan set out, in seven pull requests: the shared predicate
([#29](https://github.com/grahamfindlay/mendocean/pull/29)), Past's default set
([#30](https://github.com/grahamfindlay/mendocean/pull/30)), the upcoming
filters ([#31](https://github.com/grahamfindlay/mendocean/pull/31)), log status
([#32](https://github.com/grahamfindlay/mendocean/pull/32)), reminder prose
([#33](https://github.com/grahamfindlay/mendocean/pull/33)), card compaction
([#34](https://github.com/grahamfindlay/mendocean/pull/34)) and attendance
details ([#35](https://github.com/grahamfindlay/mendocean/pull/35)).

## Behavior

- One predicate decides which rows a list shows. `visibleOutings` replaces
  `sortedOutings` and takes the view, the type filter, the attendance filter,
  the report filter and the Show all practices override. Both My rows and the
  Rows forecast adopted it in the same change, retiring the private
  `ends_at > now` derivation that had agreed with `sortedOutings` only by
  coincidence.
- **The attendance filter describes practices only.** An independent row
  carries no BHC attendance, so intersecting the two filters would drop every
  row the owner scheduled themselves the moment they asked for the ones they
  are attending. Attendance values are compared through `bhcAttendance`, the
  importer's own normalizer, so absent and empty both read as unknown rather
  than falling through every bucket.
- Past shows independent rows, practices the owner attended, and **any row
  already logged whatever BHC now says about attendance**. That exception is
  the point of R30: attendance can change after the fact, and without it a
  report the owner wrote would disappear from their own history. A Show all
  practices control relaxes the default for correcting or importing old
  records, and a line above the list names how many rows it would add.
- Upcoming filters by type (Practices / Independent / All) and, for practices,
  by attendance (All / Attending / Unknown / Not attending). The controls live
  in one Filters disclosure with the active count in its summary and a Clear
  filters action, rather than as four segmented groups: four groups stack into
  four rows at 390px, and "Not attending" does not fit a segment at that width.
  Attendance is hidden rather than disabled once Type is Independent, since it
  could not change that list.
- A filter applies only where it is offered, decided in one place. Leaving Past
  on Unlogged and switching to Upcoming cannot silently thin a list that has no
  control for it. The filter set rides the update-resume payload, so an update
  reload — a continuation of the same visit — keeps every dimension rather than
  restoring some and dropping others. A genuine new visit starts unfiltered.
- Every past row reads **Logged**, **Needs log** or **Saved on this device**,
  each an icon and a word with color only reinforcing them. The third state
  comes from matching the row against the outbox, which `App` already loads for
  its pending banner, so it needs no new persistence. A row whose report is
  queued no longer offers Log this row: tapping it staged a second report under
  a new submission id and both would upload. The queue owns that report until
  it lands, discarding included.
- The Logged/Unlogged filter still keys off the server's reports, so a queued
  row filters as Unlogged. That is accurate — it is not logged yet — and the
  mark is what disambiguates.
- A row that cannot carry a logging reminder shows no reminder block.
  `reminderScheduleError` returned a finished sentence, so every declined
  practice carried a paragraph explaining the absence of a feature on a card
  whose badge already said Not attending. `reminderBlock` now returns a code and
  only the API turns it into words, which is the one place words were needed.
  The two account-level reasons, paused and no channel chosen, appear once
  above the list with Reminder settings beside them; `accountReminderBlock`
  raises one only when some row in the current list could otherwise carry a
  reminder. Delivery failures keep their per-card status and settings link.
- Cards carry a smaller title, "In progress" folded into the date line, and one
  primary action: View forecast while a row is ahead, Log this row or Edit
  report once it is not. Change attendance, Share, Delete and the reminder
  controls sit behind More. Reminder state stays on the face of the card so a
  scheduled, sent or failed reminder is legible without opening anything.
- Wherever the attendance dialog cannot make a change itself — deadline passed,
  change not permitted, or a save whose outcome BHC would not confirm — it names
  both routes forward: request the change in Boathouse Connect, or email the
  coaches, through a `mailto:` carrying the practice and date as its subject.
  The link drafts a message and the text says nothing is sent until the owner
  sends it. The Boathouse Connect link targets `/home/login`; it and the address
  are constants in `shared/domain.ts`.

## Verification

72 unit tests, TypeScript and Vite builds, and 21 preview browser cases, up from
69 and 17 at the start of the milestone. Both `fast` and `full-stack` passed on
every merged pull request, carrying 43 integration tests and 40 production
browser journeys. The `Workers Builds: mendocean` check fails on every commit
and is ignored: no Cloudflare Worker exists in this repository.

Two regression cases are worth naming because they were written against a
specific wrong answer rather than against the implementation. The attendance
filter case fails with `expected [ 'attending' ] to deeply equal [ 'attending',
'mine' ]` when the two filters are intersected. The Past default case fails with
`expected [ 'mine', 'attended' ] to deeply equal [ 'mine', 'logged-then-dropped',
… ]` when the saved-report clause is removed. Both were run against the broken
implementation to confirm they were not vacuous.

Deployed at `e430fb2`, confirmed by exact-commit production smoke checks. The
live site was walked at 375px across Today, Week and Rows against real provider
data, where days three through seven are hourly; `innerWidth` equals
`scrollWidth` on every view, including with the filter panel and a card's More
panel open.

The card matrix was rendered at 375px in one pass, with the preview profile
temporarily given a reminder channel: in progress, reminder scheduled, sent and
failed, declined practice, independent row, logged, needs log, and reminders
paused. Paused produced one notice for two eligible rows and zero per-card
blocks. Queued reports were exercised separately in the browser suite, which
logs a row offline and watches its mark change.

Still outstanding: confirming on the installed iPhone app that a past row with
an unsent report marks itself correctly while offline.

### Three defects found by looking at rendered pages

None of these were visible in a diff or caught by a text assertion, and two of
them were already in production.

`label` is globally `display: flex; flex-direction: column`, so a checkbox label
stacks its box above the text and centers it. M7's **Show this row on the day
chart** had rendered that way since it shipped, while every role and text
assertion passed. Both toggles now set `flex-direction` and both carry a
bounding-box height assertion, verified to fail in four cases across desktop and
phone.

A report sitting in the outbox previously rendered as **No report yet**, telling
the owner they had not written something they had just written. That is what
R31's third mark exists to prevent. Noticing it also surfaced that the same card
offered **Log this row** while its report was queued, which would have staged a
duplicate.

The first attempt at R26 made cards **taller**: a `<details>` disclosure on its
own row took a logged past card from 254px to 280px, because it hid one button
and charged a full 44px row for it. A disclosure only pays when it hides several
things. The toggle became a button inside the action row instead, which brought
the same card to 236px and an unlogged one from 252px to 234px. This was caught
by measuring the card before and after rather than by looking at a screenshot
and calling it compact.

### One unexplained loose end

While building the filter bar, a `<details>` with a computed `flex-basis` of
`100%` and `flex-shrink` of `0` laid out at 118.84px inside a 350px wrapping
flex container. The computed values were read back from the browser and were
correct; the used width was not. Rather than keep probing a cosmetic question,
the element was moved out of the flex container to be a plain sibling block,
which is better markup regardless. If a similar width appears elsewhere in
`styles.css`, this is the thread to pull.
