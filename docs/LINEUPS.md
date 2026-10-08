# Published practice lineups

Implemented locally on October 7, 2026. Not deployed or activated. Live regular-rower reads passed, and the user accepted the provider visibility assumption described below. Physical iPhone checks remain the release requirement.

## Behavior

Connected attendees get a Lineups tab and a View lineup action on scheduled practices. Only attended, published practices appear; the view remains available until practice ends. The attendee's boat comes first, their seat is labeled You, and other boats can be expanded. Boat class, rowing side, assigned coach, location and practice plan are included where supplied. Weight, age, contacts and coach-only details are excluded.

The screen reads Mendocean snapshots immediately and refreshes saved data on entry, return from the background, and once per minute while visible. Check for updates queues a provider refresh, throttled to one per minute. Publication times are not inferred: the UI shows when BHC was checked. Expired credentials retain the last saved snapshot with a reconnect notice; disconnect or missing club membership removes access. Browser account changes clear personal state. Crew data is never added to the public service-worker cache.

## Synchronization and delivery

Existing full imports establish snapshots. Initial connection and replacement credentials establish a baseline without retrospective alerts. A dedicated job checks practices every five minutes from their signup deadline through 30 minutes after practice starts. Missing deadlines use a 24-hour fallback. Provider metadata and detail must explicitly confirm publication; missing or malformed fields fail closed. Lineups marked unpublished are never persisted. For edits to already-published lineups, the rollout relies on BHC returning only information the regular rower is permitted to see, as accepted by the user below.

Each attendee has a private snapshot scoped to their BHC connection revision. No teammates need Mendocean accounts. Snapshot updates and durable notification events are committed atomically. Relevant versions change for publication status, the attendee's assignment, their own crew/coaches, or practice details. Changes only to another boat or display-name corrections refresh the view without triggering alerts. Crew lists are normalized before comparison.

Account has separate lineup email/push preferences, disabled by default, and a choice of own assignment only or assignment plus crew. Logging reminder pauses do not affect lineup notifications. Email contains the attendee's entire boat, coach, practice information and change summary in HTML and plain text. Links point to the selected practice in Mendocean and survive sign-in. BHC's existing email preferences are not changed.

Delivery rechecks current attendance, credentials, connection revision, publication, snapshot version, preferences, freshness and expiry before each channel/device. Superseded pending jobs are cancelled. Email content and recipient are pinned to a stable provider idempotency key; successful push devices are checkpointed across retries. Push tags replace prior notifications for the same practice; transport ambiguity can still cause a repeated push. Expired push subscriptions are removed. Email and push fail/retry independently. Lineup and logging emails share the existing 80-per-day reservation budget; authentication remains outside that allowance. Snapshots are removed two days after practice ends, and notification events/content after seven days.

## Provider contract and accepted assumptions

The live check confirmed an attended published practice includes boats, crew names, seats and coach-to-boat associations using the user's connected token. On October 7, 2026, the user confirmed that this BHC account has only regular rower access, completing ordinary-member permission confirmation.

The user is fairly confident that saving a coach edit does not immediately publish it and explicitly chose to proceed under the assumption that BHC's API will not return information the rower is not supposed to see. Controlled coach draft/republish observations are therefore deferred, rather than an activation prerequisite. This is an accepted assumption, not a behavior established by the live reads. Both explicit publication flags must still be `Yes`; an assigned seat alone never establishes publication.

If later observations contradict that assumption, disable the feature and revisit the provider contract. Coach observations and confirming acceptable polling frequency with BHC remain useful follow-ups. The project TODO requests a Zapier webhook for publication and changes; no messages to BHC have been sent.

`node scripts/bhc-lineup-contract.mjs` performs at most six read requests with a token supplied through `BHC_CONTRACT_TOKEN`. `BHC_CONTRACT_CLUB_ID` and `BHC_CONTRACT_PRACTICE_ID` can identify the test practice; `BHC_CONTRACT_PAST=true` checks recent/past practice listings. Output contains counts and fingerprints, never names, raw payloads or credential-bearing URLs. An optional `BHC_CONTRACT_BASELINE` file stores only these diagnostics to compare observations. The script does not publish/edit lineups, change attendance, send email, or establish that the token is an ordinary member's; verify account permissions separately.

### Live observations on October 7, 2026

After explicit user approval, the existing encrypted BHC connection was retrieved with a single read-only SQL SELECT and decrypted in memory. No Supabase service-role API key was needed. Credentials, names and raw provider responses were neither printed nor saved. No attendance, lineup, application or notification changes were made.

The connected account's identity and Mendota membership matched. Six BHC GET requests verified a previously attended, published practice: both metadata and detail returned `lineups_set=Yes`; normalization produced two named boats, nine named crew members, two assigned coaches and the user's own boat/seat. Actual fields matched the implementation: attendance has `custid`, `fname`, `lname`, `lineup_boat`, numeric-string seats or `coxswain`, and `lineup_side`; coaches use `boat_id` plus `custid`; equipment uses `boat_id`, `boat_name`, `boat_type`, `coxed` and `rigging`. Four further GET requests verified an upcoming unpublished practice with `lineups_set=No` in both responses and no assigned crew; normalization suppressed it.

No upcoming attended published practice was available, so the published example came from past practices. The user subsequently confirmed this account has ordinary-member-only permissions. The unpublished example contained no draft assignments, so it does not prove suppression of assigned drafts or the behavior of unpublished edits after first publication. The user accepted proceeding on the provider visibility assumption above. Physical iPhone checks remain pending; the feature stays disabled until the release check is completed.

## Release and real-device check

Apply migration `202610070002_lineups.sql` and deploy compatible api/jobs functions and the frontend. Enable `BHC_LINEUPS_ENABLED=true` in the test environment for the physical iPhone check; keep it false for general release until that check passes. Provider verification is complete to the extent accepted by the user above; controlled coach observations no longer block rollout. Disable the flag to stop polling, lineup sends and client access without deleting rowing reports or practices. No production migration or deployment has been performed in this task.

On a physical iPhone, add Mendocean to the Home Screen, sign in and register push. Opt in to lineup notifications separately. Receive a publication push with the app closed; tapping it must open the exact practice with the user's boat first and seat highlighted. Repeat for a seat move and removal, a signed-out session, and an email link opened from Mail. Confirm the destination survives OTP sign-in, background return loads the latest snapshot, and Focus/notification settings behave as expected. Mobile WebKit emulation does not establish these OS-level behaviors.

## Automated validation

- Unit checks: publication gates, crew normalization, identity/order-independent comparisons, seat/boat/removal summaries and escaped full-crew email.
- PostgreSQL checks: member isolation, private RPC permissions, atomic events, revision guards, opt-ins, immutable retries, device checkpoints, superseded alerts, unpublication, stale snapshots, expiry and disconnect.
- Isolated Supabase/Edge Function checks: actual importer-to-snapshot-to-email/push flows with synthetic providers, independent retries, declines and reconnect baselines.
- Browser checks: conditional navigation, direct practice selection, own boat first, You highlight, collapsed other boats, mobile layout and selection preserved on reload in Chromium and WebKit.
