# Pilot acceptance checks

## Automated technical coverage

See [TESTING.md](TESTING.md) for repeatable commands. The disposable Supabase stack exercises Auth, account isolation through API/RPC/table access, report persistence/retries/conflicts, official and independent outings, BHC attendance and lineup updates, reminder suppression/retry/rescheduling, push endpoint isolation, weather archives/failures, and queue claims/budgets. Production-build browser tests cover login, logging/editing, offline recovery, account switching, and notification setup. Fixtures do not establish provider semantics or visible OS notification delivery.

## Remaining live acceptance

- Owner confirmed actual email-code login and desktop push delivery on September 14, 2026.
- Compare one real BHC practice (including attendance) and posted lineup with the app. The owner has connected BHC; semantic agreement remains unverified. A bounded read-only contract command is documented in `TESTING.md`.
- Observe one opted-in scheduled reminder and follow its link during ordinary practice use. Delivery retry and suppression edge cases are automated; inbox placement and real-device display are not.
- If supporting iPhone, install the PWA, save offline, close/reopen, reconnect, and check notification links. Desktop WebKit and mobile emulation do not establish this behavior. Device drafts can be cleared by the browser/OS and are not a cloud backup.
- Record real logging times for prefilled and independent outings; targets are roughly 10 and 20 seconds. Gather feedback on labels and friction during normal practice use.

## Separate pilot operations

- Activate and restore an encrypted backup into an isolated environment; keep recovery and BHC encryption keys independent of the backed-up services.
- Review database/weather storage, egress/invocations, Resend usage, and GitHub artifact use against service quotas. The admin health endpoint exposes application health; provider-wide billing meters remain dashboard checks.
- Do not promote learned forecasts just to demonstrate the feature. Hannah's rule remains useful while observations accumulate.
