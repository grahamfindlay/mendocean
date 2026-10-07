# Boathouse Connect connection plan

Guided setup deployed October 7, 2026. Live password exchange verified the same day; see [deployment](DEPLOYMENT.md#bhc-connection-rollout) for the observed responses and expiry.

Recommend an API key created in the user's BHC profile, while offering connection with BHC email and password as a visible alternative. Replace the unexplained key and club ID fields with guided setup, automatic Mendota Rowing Club membership matching, accurate connection status, and direct reconnection. Both paths remain optional; Mendocean sign-in and rowing logs work independently.

## Provider capabilities and release prerequisites

BHC documents `authenticate/generateApiToken` for exchanging email and password for a token, `authenticate/checkApiKey` for validation and expiry metadata, and user-supplied tokens from My Profile. Its documentation says password-generated tokens last six months and become invalid after an email or password change. The live exchange on October 7, 2026 returned a 365-day expiry instead. Always use the returned expiry timestamp and avoid promising a fixed duration. Profile-created tokens are documented as valid until manually deleted. No refresh-token flow is documented. [BHC authentication documentation](https://app.boathouseconnect.com/home/apidocs/1).

Before enabling password connection, verify the exchange request format, invalid-credential responses, expiry timestamp semantics and token rejection responses with BHC. These checks passed in the deliberate live test on October 7, 2026. BHC recommends profile-created tokens; retain that recommendation and renew password-generated access through an explicit user sign-in when the returned token expires. The live test establishes this account's behavior, not every account restriction or multi-factor configuration.

Verify the My Profile link and exact token creation labels on a signed-in BHC account, on desktop and mobile, before writing illustrated instructions. Public docs identify My Profile, but don't establish its current signed-in UI. Confirm whether login preserves the destination. If the deep link does not, link to BHC login and give a reliable route to My Profile. Instructions must use BHC's actual labels and explain that "API token" is the term to look for.

Automated tests use an isolated local Supabase stack and synthetic upstream responses. The deliberate live password test generated and removed its own BHC tokens, verified Mendota membership, expiry metadata and rejection after deletion, and did not change Mendocean connections, practices, attendance or notifications. Email/password-change invalidation remains documented behavior; no real account credential was changed for testing.

## Setup and user-facing copy

### Account entry

Keep the Boathouse Connect section in Account. Heading: **Integrate with Boathouse Connect**. Benefit: "Import your practices and manage attendance." Show **Connect Boathouse Connect**. The wizard uses the existing modal conventions, with mobile reflow, Back, Close, and focus restoration. Closing setup preserves the rest of the account settings. Do not promise lineup functionality in connection copy.

### Method choice

Use the heading **Integrate with Boathouse Connect**, without a separate BOATHOUSE CONNECT eyebrow. Benefit: "Import your practices and manage attendance." Give the API key route visual priority and a **Recommended** label. Title: **Connect using an API key**. Description: "Stays connected until you revoke the API key." Action: **Use an API key**.

Keep **Use BHC email and password instead** visible immediately below it. Description: "Requires reconnecting when the connection expires, or if your BHC email or password changes." Keep **Maybe later** at the bottom, without additional optional-login explanatory copy. Do not hide the alternative or require a failed API key attempt first.

### API key route

Show three short steps: open My Profile in BHC, create a dedicated token named Mendocean, and copy it back here. Use the actual BHC labels once verified. The implementation includes text instructions. Add an annotated image after verifying the signed-in BHC UI, with all private account information redacted. Open BHC in a separate tab so returning does not restart setup. Preserve only the selected route when returning to the app, never a secret in navigation or persistent browser storage.

Title: **Connect using an API key**. Label the field **BHC API key**, with help: "BHC calls this an API token." Mask the value; offer Show/Hide and ordinary paste. Trim surrounding whitespace, accept the provider's verified token format, and return a specific validation message. Don't ask for broad clipboard permission or read the clipboard automatically. Provide the alternate password route on this screen too.

Copy describes importing practices and managing attendance. Do not claim the BHC key itself is restricted to those capabilities or describe the connection as read-only.

### Password route

Title: **Connect with your BHC login**. Fields: **BHC email** and **BHC password**, with Show/Hide. Keep these labels distinct from Mendocean sign-in. Include: "We use your password to connect to BHC and don't save it." Renewal copy: "Requires reconnecting when the connection expires, or if your BHC email or password changes."

Use a native form with `autocomplete="username"` and `autocomplete="current-password"`, but verify password-manager behavior across the separate Mendocean and BHC origins; autofill may require manual selection. Don't prefill Mendocean's email as if it were known to be the BHC email. Offer **Use an API key instead** and a verified BHC password-reset link. Clear the password on completion, close, route change, and session change. No request is made until the user submits.

Disable duplicate submission and announce **Connecting to BHC…**. Map verified credential rejection to "BHC didn't recognize that email and password. Check them and try again." Timeout/offline errors say access could not be checked and allow a deliberate retry. A timeout during token generation must not automatically generate further tokens.

### Mendota membership and account identity

Mendocean connects only to Mendota Rowing Club. Both routes validate the token and find the trusted, configured Mendota BHC club ID in the account's memberships. Select that membership automatically even if the account belongs to several clubs. There is no club picker or client-supplied club choice. For first setup, an administrator may discover a single club whose name contains “mendota”, ignoring case, and pin its numeric BHC ID. Alternatively configure the verified `BHC_MENDOTA_CLUB_ID`. Later connections match only that pinned ID, regardless of display-name changes or membership order. Multiple name matches require explicit configuration; regular members cannot pin the global club.

If Mendota membership is missing, do not save the candidate connection or import another club. Show **Mendota membership not found** and "This BHC account isn't a member of Mendota Rowing Club." Offer **Use a different BHC account** and **Check membership in BHC**. Keep a prior connection until a valid replacement succeeds. Removed membership on an existing connection is a membership problem, not proof the credential has expired; suspend BHC work until resolved.

Enforce this in the API, private connection writes, sync, and attendance. The legacy `bhc/connect` endpoint must reject any supplied club ID other than Mendota's and automatically use Mendota when the ID is omitted. Old clients must not bypass the restriction. Audit existing connections before rollout: flag any non-Mendota connection, stop its BHC work, and preserve saved logs and imported history. The implemented API and private connection trigger enforce this restriction.

Verify BHC account identity on the server without adding another selection screen. Do not return the full provider profile. On reconnect or method change, require the existing BHC `custid`; if a different account is supplied, keep the existing connection intact and say "This is a different BHC account. Sign in to the account you previously connected." Linking a different athlete is a separate deliberate account-management flow, outside this change. Prevent accidental token sharing between Mendocean accounts; reject a provider identity already linked elsewhere and offer support without exposing the other account.

### Connection and import completion

Distinguish authentication from practice import. After connection commit: **Connected to Mendota Rowing Club · Importing practices…**. Show actual progress stages, never a simulated percentage. Poll status only while setup/import is visible, with bounded polling and a recoverable delay message. A delayed import does not send the user back to password entry.

After successful import: **Connected · Practices up to date**, with the last successful update. Label the expiry date **Renew connection by**. An empty schedule says **Connected · No upcoming practices found**. A partial or failed import stays visibly incomplete. Close the wizard only on user action.

## Connection lifecycle

| State | What the user sees | System behavior |
| --- | --- | --- |
| Not connected | Optional connection action | No BHC import or writes for this user |
| Importing | Connected; importing practices | New token is valid; imports run with bounded progress polling |
| Healthy | Club and last successful update | Normal sync, attendance, and eligible reminders |
| Renewal due | "Renew your BHC connection by [date]" | Seven-day warning; connection remains usable until expiry |
| Reconnect required | "Reconnect Boathouse Connect" | Confirmed invalid/expired access; suspend BHC work until renewal |
| Temporary problem | "BHC is temporarily unavailable" | Bounded retries; keep credentials; no password prompt |
| Import incomplete | "Connected; practices could not be fully updated" | Retry supported import failures; retain trustworthy prior data |
| Offline | "Connect to the internet to check BHC" | Local offline state; do not change canonical credential validity |
| Missing Mendota membership | "Mendota membership not found" | Block setup or pause an existing connection; never fall back to another club |

Show reconnection notices in Account and above My rows so users encounter them without hunting through settings. Attendance actions also lead to reconnection when access is confirmed invalid. Avoid duplicating multiple banners for the same cause within a view. Keep the notice until recovery; an informational upcoming-renewal notice can be dismissed until a later visit, but permanent dismissal must not hide expired access.

Reconnect copy: "Your BHC connection needs to be renewed. Reconnect to keep practices and attendance up to date. Your saved rowing logs are safe." Use a known expiry reason when available; never guess that the password changed. Primary action uses the previous method, while the profile route remains offered as the recommended way to reduce future renewals. No disconnect-first step.

Keep imported practices and reports. Connection notices show **Last updated [time]** when access is lost or updates fail; don't call it current. Independent rowing logs, weather, Mendocean sessions, and reminder preferences remain usable. Stop attendance writes on expired/invalid access. Preserve the existing uncertain-write journal and readback behavior if invalidation occurs during a write; reconnection never replays that write automatically.

Pause BHC-derived reminder delivery when credentials are invalid or expired, and while a renewed connection has not refreshed the affected practice. Add send-time enforcement as well as scheduling enforcement so already-claimed jobs cannot deliver based on stale membership. Preserve per-outing skips and preferences. Rebuild only reminders still within their original delivery window after a successful refresh; do not send a backlog. Independent-row reminders continue. A temporary provider failure should use the existing freshness policy, with an explicit rule before launch: withhold BHC reminders whose relevant practice could not be refreshed for its scheduled checkpoint, rather than indefinitely trusting old attendance.

Initially use in-app renewal/reconnect notices. Email or push renewal alerts require separate notification settings and copy; no unsolicited new notification channel is introduced in this change.

## Backend design

### Connection data

Extend the private connection record with `method` (`provided_token`, `password_exchange`, or `unknown`), `expires_at`, canonical access state, sanitized error text, `last_attempt_at`, `last_successful_sync_at`, a monotonic connection revision, and import status. Keep tokens encrypted using the existing server key and inaccessible through ordinary client queries.

Store BHC's returned expiry rather than estimating it as 180 days. Missing or ambiguous expiry stays unknown until provider semantics are verified. The seven-day renewal warning is derived from expiry, not a persisted state. Keep local connectivity separate from server access state. Treat supplied tokens according to their actual metadata; a token pasted manually could itself have been password-generated.

Existing Mendota connections continue working. Backfill their method conservatively and validate metadata during ordinary use. The old `last_sync` field currently advances on failed attempts; historical successful timestamps cannot be reconstructed reliably from it. For migrated connections, display "Last successful update not yet confirmed" until a real successful import establishes the new field; preserve old timestamps only as attempts. Return legacy fields during transition, with `last_sync` mapped to verified success and `connected` false for invalid/expired access or ineligible club membership so old clients do not present a healthy connection. New clients use explicit states.

### Connection API

Use a shared connection service behind two authenticated endpoints. Club selection is gone, so setup needs one submission:

1. `POST bhc/connect`: accept a supplied token. Preserve legacy request compatibility, but reject a non-Mendota `club_id`. Validate the credential, find the configured Mendota membership, and check account identity and the expected existing connection revision before committing.
2. `POST bhc/connect-password`: accept only BHC email, password, and bounded request metadata. Authenticate the invited Mendocean user, apply rate limits, exchange credentials, then run the same token, membership, identity and revision checks. Atomically replace the connection and enqueue initial sync. Return safe status and the Mendota club name, never the credential.
3. `GET account` or a small status endpoint: return states, expiry, method, club, successful update timestamp, and safe problem codes. Never return tokens, passwords, raw provider responses, or arbitrary provider messages.

No pending-token handoff or club selection API is needed. Use a user-bound request ID to prevent duplicate concurrent exchanges and return a safe completed result for a known committed request. Store request status, not submitted credentials. If the browser times out after submission, check connection status before offering a deliberate retry; do not automatically generate another token. An uncommitted generated BHC token can remain upstream if later validation fails; Automatic upstream cleanup remains disabled until deletion ownership/semantics are verified. Users can remove abandoned tokens from their BHC profile. Don't revoke user-supplied tokens automatically.

The previous committed connection remains usable until the replacement succeeds. Cancellation, bad credentials, missing Mendota membership, or a network failure must not destroy it. Connection replacement waits for sync and attendance leases. Disconnect erases credentials, cancels running setup attempts, and advances a retained revision tombstone; guarded imports/readbacks cannot restore disconnected data. A BHC attendance request already submitted can still finish upstream, so its result remains subject to the existing uncertainty/readback rules. Every running job checks the connection revision before applying imported data, marking failures, or scheduling reminders; stale work from the old token must not overwrite the new connection. Apply guarded data changes in database transactions, including existing paged imports.

### Failure classification

Create a shared BHC adapter for allowlisted GETs and credential/token POSTs. Map tested provider outcomes to safe categories: credential rejection, token invalid, rate limited, transport unavailable, permission denied, and unexpected response. Neither an empty practices list nor a generic 403 establishes token invalidity. If an import fails and the cause is unclear, use a bounded `checkApiKey` probe; only a verified rejection or known expiry puts the account in reconnect-required state. An ambiguous probe keeps the temporary-problem state.

Stop scheduling/claiming ordinary sync work for known expired/invalid credentials; queued jobs recheck and terminate safely. Temporary failures use bounded backoff and provider rate limits. Expiry must be checked before sync, attendance, and reminder delivery, even if no daily job has marked it yet. A server-side read detects known expiry promptly when the user opens the app. Reconnect clears the credential problem immediately, but stale-data labels clear only after successful import.

## Credential handling

Accept credentials only over HTTPS in an authenticated POST body to the fixed BHC adapter. Enforce a small request-size limit and a concrete server-side limit of five password exchange attempts per user per fifteen minutes, The implementation enforces this in the private server-side request journal; gateway throttling can supplement it during rollout. Treat this as an initial product limit to validate during pilot. Return an actionable retry time without revealing account existence beyond BHC's verified sign-in result.

Keep the password only in request memory during the exchange; never persist it, place it in jobs, use it for background renewal, or include it in URLs. Clear frontend references when the form ends. Do not retry credential-generation POSTs automatically after an uncertain result. The backend token check and club reads can retry only under the bounded adapter policy.

Review PostHog configuration, autocapture, replay, API error handling, edge logs, observability, and any request-body capture. Explicitly mask/exclude the whole BHC credential form and allowlist event fields. Tokens are passed in BHC query strings today, so never log provider URLs or native fetch errors. Synthetic secret-canary tests must confirm that credentials do not escape through responses, logs, analytics, or client storage. Don't claim a token provides least-privilege access if BHC does not support it.

Disconnect removes Mendocean's encrypted credential and BHC work while preserving rowing reports. Explain how users can remove the dedicated profile token inside BHC. Automatic deletion of an owned password-generated token, if supported, should have explicit, tested semantics; never delete a user-provided token that could be shared with another integration.

## Implementation sequence

| Phase | Work | Completion condition |
| --- | --- | --- |
| Provider verification | Confirm supported recurring exchange, failure/expiry contract, profile UI and mobile return path | Exact mappings and instructions established; password route remains feature-disabled until supported |
| Connection foundation | Migration, safe status API, adapter classification, revision guards, expiry/retry/reminder enforcement | Existing connections retain behavior; invalid access cannot produce BHC writes or stale reminder delivery |
| Guided setup | Extract BHC section/wizard, API key guidance, automatic Mendota matching, import and reconnect UI | API key flow works end to end at mobile/desktop widths, including legacy tokens and multi-club accounts |
| Password option | Authenticated exchange, limits, secret handling, switching methods | Same lifecycle and club flow pass; no credential leakage or unexpected connection replacement |
| Pilot and release | Deploy backend before frontend; enable password option for a small cohort, then expand | Required CI, device checks, deliberate provider verification, and observed successful reconnection |

Expected change locations: `src/Account.tsx` (extract connection UI), `src/App.tsx` and My rows views (status/banner), `src/AttendanceEditor.tsx` (typed reconnect recovery), `src/client.ts` (safe error codes), a new shared BHC connection schema, `supabase/functions/api/handler.ts`, `_shared/bhc.ts`, `_shared/attendance.ts`, jobs and reminder logic, private database RPCs/migrations, preview/fixture adapters, and telemetry allowlists. Locate the attendance adapter's actual entry points during implementation.

Use an additive migration first, then deploy backward-compatible API and workers with password exchange disabled. Deploy the frontend next and check the profile flow before enabling password exchange. Rollback disables new password setup, while existing password connections retain validation/reconnection status and the profile route remains available. Keep schema additions so rollback does not discard encrypted connections.

## Acceptance and validation

- Both routes are visible on first entry; API key is recommended. Use the approved concise copy and exclude lineup promises. The alternate stays available during key setup and reconnect. Closing/backing out clears secrets and preserves existing connections.
- Mendota membership is selected automatically, regardless of membership count or list order. No club picker appears. Missing or removed Mendota membership blocks connection/import with a specific message. Forged non-Mendota IDs are rejected in legacy and new APIs, private connection writes, sync and attendance. Existing non-Mendota connections are flagged without deleting logs.
- Successful connection, slow import, empty schedule, partial import, and credential rejection have distinct messages. A valid connection never claims practices have finished importing early.
- Known expiry at seven days, at the exact boundary, unknown expiry, manual token deletion, and invalidation on email/password change map correctly. Server enforcement works even when the user has not opened Account.
- Offline, timeout, 429, malformed body, and generic permission errors do not spuriously require reconnection. Empty legitimate data does not invalidate tokens. The actual auth failure contract is covered by provider fixtures.
- Reconnect works without disconnecting, supports switching method, keeps Mendota/athlete identity, and rejects an accidentally different account. Duplicate submits, session switching, cancelled setup and token-generation timeout retain correct state.
- Old sync/attendance jobs cannot alter a renewed connection or undo its status. Invalid/expired tokens stop new work. Attendance interrupted in flight retains uncertainty and cannot replay itself.
- BHC reminders stop at invalidity and resume only after the relevant refresh within the original window; preferences/skips persist. Claimed jobs enforce state at delivery. Independent reminders and logging continue.
- Password/token canaries do not appear in persistence, returned payloads, logs or analytics. Request IDs are user-bound and bounded; duplicate requests cannot bypass exchange limits.
- Keyboard navigation, focus restoration, labeled fields, announced errors, password visibility, mobile keyboard and text zoom work at 320px and larger. Verify actual cross-app/tab return in iOS Home Screen Safari, Safari and Chromium; desktop browser fixtures alone do not establish it.

Run focused domain/adapter and database tests for membership/state/classification/expiry/concurrency, real local-backend integration tests for connection, and production-build browser journeys for both paths and recovery. Broaden to required CI once these pass. Real credential exchanges or deletion are deliberate provider-contract checks, never unattended CI or tests against pilot users. No test changes real attendance or sends real reminders. The implementation includes domain/SQL tests, synthetic password-exchange and lifecycle integration tests, and production-build setup/reconnect browser journeys. Real-provider contract and physical-device checks remain release prerequisites.

The implementation records setup submission/failure and completed connection/disconnection events, with an allowlisted method and action. Additional method-selection, membership, import and renewal funnel events can follow after pilot validation. Allow only method/state/category and timing fields, with pseudonymous account correlation under the existing telemetry policy. Track completion and reconnection rates, plus time to successful first import. Expected renewal is an actionable account state, not a recurring infrastructure incident. Use the existing analytics sink; no new analytics service is required.

## Mock-up scope

The interactive proposal shows method choice, API key guidance, password entry, missing Mendota membership, importing, connected, renewal due, expired/manual invalidation, temporary outage, invalid credentials, empty schedule and partial import. Dates are illustrative, and inputs are sample-only. It makes no BHC requests. Final token screenshots, production password-manager behavior and provider error mappings belong to the verification phase above.
