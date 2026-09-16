# Milestone 1 delivery

## Implemented

- Concise Now, Hourly, Forecast and Log screens; Hannah-style source-bearing compass, colored wind numbers, gust shorthand and weather descriptions. Weather provider and wind heuristic are identified separately.
- Actual estimate timestamps, strictly future timeline rows, advancing-clock selection and refresh on return. Hourly resolution remains explicit; quarter-hour ingestion and charts belong to M2.
- Forecast replaces Plan, preserves an outing’s start/duration, and exposes only validated model contexts. Public capabilities omit coefficients and other users’ personal models.
- Upcoming/Past views, report filters, BHC attendance labels and clear independent-outing actions. Future outings cannot be selected for logging; in-progress outings can be logged after an early return.
- Logging-reminder state reflects authenticated delivery/queue data. Saved reports have no reminder controls. The API rejects expired, already-logged, attendance-ineligible and account-disabled scheduling requests.
- iOS Home Screen setup guidance and separate permission/device-registration states. No permission request occurs on page load.
- Green/gold/dark Mendocean icons, regenerated PNGs and refreshed app-shell cache. The club palette was matched visually to the reviewed logo; exact source-asset sampling was unavailable.

These cover M1 issues D01–D02, D05–D10, D11 presentation, D12–D17, D19–D21 and D23. M2–M4 remain unchanged.

## Validation

Local checks pass: TypeScript/Vite build, both Edge Function type checks, 47 fast tests, 8 Python tests, 12 preview browser cases, 26 real Supabase integration tests and 31 production-build browser cases. Two persistent-profile variants are intentionally skipped outside desktop Chromium. Browser journeys run Chromium, WebKit and mobile Chromium emulation against an isolated backend with synthetic providers. A transient offline-profile startup failure did not recur in the final full run; sanitized startup diagnostics are retained for future failures.

Desktop and 390px layouts were inspected interactively, including Now, Forecast and Upcoming outings. Icon artwork was inspected at 192px. Installed iPhone icon masking, offline behavior and actual OS push display remain real-device acceptance work; emulation does not establish those results.

## Release order

1. Required GitHub `fast` and `full-stack` checks must pass.
2. Apply additive migration `202609150001_reminder_presentation.sql`, then deploy the `api` Edge Function. Existing clients remain compatible. No jobs-function deployment or preference migration is required.
3. Merge through the protected main branch; Cloudflare Pages publishes the frontend.
4. Run read-only API/Auth/browser smoke checks against the exact deployed commit. Do not create production reports, BHC attendance writes or pilot reminders for testing.

Release outcome is recorded in the pull request and delivery response.
