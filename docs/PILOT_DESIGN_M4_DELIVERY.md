# Milestone 4: BHC attendance editing

## User workflow

Upcoming BHC practices offer Change attendance when a BHC account is connected, or Attendance details after the imported deadline. The editor fetches current BHC status and its athlete-specific attendance window. Users can choose Attending or Not attending and explicitly Save attendance in BHC. Unknown remains a displayed provider state, not a write option. Independent outings and past practices do not offer this editor.

The server checks membership, connected club, current eligible-practice listing, provider permission flag, window boundaries and expected prior attendance before each change. Missing permission/window metadata disables changes. The actual BHC deadline is used, not a hardcoded 5pm. Closed or restricted practices link to BHC; late-request submission remains outside this milestone.

After submitting, the server reads BHC again. Only confirmed current state updates the attendance badge and reminders. A provider rejection, capacity restriction, no-op success response, deadline closure or ambiguous timeout never becomes an optimistic success. An uncertain result asks the user to check BHC status. Attendance writes are never added to the offline report queue or automatically retried.

## Integration and limits

The request body accepts only an outing ID plus an optional explicit change with expected attendance and a request UUID. It rejects additional fields. The user identity comes from Auth and the encrypted BHC connection; the provider write omits `custid`, targeting the token's own athlete. Credentials and raw provider responses are not returned or logged.

Attendance operations share the existing per-user BHC sync lease, preventing an import from overwriting a concurrent change with a stale snapshot. A private request journal is written before the provider POST; replaying an attempted request reads current status without repeating the POST. The journal and state-application RPCs are restricted to the service role. Reconnection during preflight rejects the operation. The final provider response is reconciled through a read even when the transport fails.

Confirmed attending status restores eligible reminders while preserving explicit skip preferences. Declining cancels pending reminder jobs and clears that user's planned seat/boat. Existing workers recheck attendance before delivery. Read-only BHC synchronization refreshes the remaining practice/lineup metadata afterward. Reports remain unchanged.

BHC does not document an atomic compare-and-set operation or idempotency key. The expected-state check protects stale Mendocean clients, but another change made directly in BHC can race between the preflight read and write. Provider-side permission enforcement is still authoritative. A successful readback establishes the state at that time, not that it cannot change afterward.

## Verification and release

The documented POST parameters and GET eligibility fields were checked against [BHC practice API documentation](https://app.boathouseconnect.com/home/apidocs/8). A read-only check of the owner's connected account on September 16, 2026 confirmed actual boolean permission flags, Unix window timestamps, and both open and closed practices. No real signup was changed during unattended testing.

Automated coverage: 55 fast tests, production build and both Edge Function type checks; 43 real-backend integration tests and 40 production-build browser cases, with the two existing persistent-profile exclusions. Coverage includes own-user isolation, private RPC permissions, independent outings, malformed/extra inputs, stale attendance, deadline opening/closure, provider restrictions, capacity-style rejection, successful HTTP no-op, interrupted acceptance, failed readback, duplicate requests, overlapping requests/imports, reminder cancellation/restoration and skipped reminders. Browser journeys verify saved status after reload, uncertain-result recovery, closed-window guidance and offline refusal in Chromium, WebKit and mobile emulation.

Release order after required CI: apply `202609160002_bhc_attendance.sql`, deploy `api`, then publish the frontend through the protected main branch. The jobs function needs no change. Run read-only live API/Auth/browser smoke tests against the exact deployed commit.

The remaining real-provider write acceptance check must use one practice and attendance choice explicitly selected by the owner, or be performed by the owner through the released UI. Do not pick a real signup simply to exercise the endpoint.
