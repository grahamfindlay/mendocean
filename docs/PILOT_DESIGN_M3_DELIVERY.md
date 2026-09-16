# Milestone 3: email and push together

## Behavior

Account offers independent Email and Push notifications checkboxes. Neither selected turns reminders off; Pause all reminders remains separate. Migration preserves every existing choice without adding a channel. Cached clients using the legacy single preference remain supported. Push device registration and channel selection remain separate, with a warning when push is selected but no device is registered.

My outings shows each selected channel's delivery state, including partial success, retrying, missing devices and failed attempts. “Sent” means accepted by the provider, not proof that a person saw a notification. Saved reports suppress reminder controls and further deliveries. Explicit “Remind me again in 1 hour” creates a new generation and intentionally sends all selected channels again.

Preference changes apply to upcoming and eligible unfinished reminders. Successful channels are retained; disabling a failed channel can complete the reminder. Adding a channel does not reopen an already completed generation. Registering a device can restore an unfinished push reminder. Existing pending snooze times are preserved.

## Delivery and compatibility

Each user/outing/generation/channel has an independent reservation, lease, outcome and provider key. Push also checkpoints accepted endpoints, so a transient failure on another device does not resend known successes. Expired endpoints are removed. Eligibility is checked before each provider request; report suppression, attendance, opt-outs, pause and the end +15 minutes through end +24 hours window remain enforced. Email's daily reservation quota does not block push.

Email retries retain the original recipient and content as well as the idempotency key, including when practice details change after an ambiguous send. Retries beyond the key's 24-hour reservation age are rejected. This follows [Resend's idempotency contract](https://resend.com/docs/dashboard/emails/idempotency-keys). Existing pending legacy deliveries retain their original provider keys; previously accepted sends remain completed.

Push providers do not supply equivalent request idempotency. An ambiguous network failure or a crash between provider acceptance and its database checkpoint can still cause a duplicate. Notification tags reduce visible duplication but do not establish exactly-once delivery. Browser automation also cannot prove actual iOS notification display.

Private delivery tables use RLS and service-role-only RPCs. Account responses expose safe status/count fields, never endpoints, email payloads, leases or provider credentials.

## Validation and release

Local validation: 54 fast tests, production build, both Edge Function type checks, 14 preview browser cases, 35 real-backend integration tests and 37 production-build browser cases. Two persistent-profile variants are intentionally excluded outside desktop Chromium. Account layout was reviewed at desktop and phone widths.

Coverage includes preference migration with historical deliveries, both/neither selection and persistence, each channel failing independently, provider acceptance before timeout, changed email content on retry, multiple devices, missing/expired devices, report submission after partial delivery, preference changes, quota independence, generation changes and concurrent reservations. Synthetic providers are used; no pilot notifications are sent for testing.

Release after required `fast` and `full-stack` checks: apply `202609160001_multi_channel_reminders.sql`, deploy `jobs`, deploy `api`, then merge the frontend. Verify the exact deployed commit with read-only production smoke checks. The schema is additive and supports cached clients. Once users select both channels, fix forward rather than restoring the old single-channel worker; that worker cannot honor both choices.
