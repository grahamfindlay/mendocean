# Pilot launch checks

Local development can continue without service credentials. Before treating the app as a live pilot, complete these checks in the configured services.

- Sign in with two invited accounts; verify one account cannot read, alter, delete or export the other’s reports through direct API/RPC calls. Confirm anonymous forecasts work and anonymous reports fail.
- Log a row, an uncoached independent outing, and a weather-related attempt that stayed ashore. Edit and delete a report. Retry the same submission and verify one saved report. Verify a stale concurrent edit prompts a reload.
- Put a phone offline, create a draft/report, close and reopen the installed app, reconnect, and verify upload. Switch accounts and confirm device drafts remain separated. Device storage can be cleared by the browser or operating system; it is not a cloud backup.
- Connect BHC for Graham. Compare the attending, declined and unknown practices against the BHC UI, then inspect a posted lineup. Confirm imported scheduled/planned fields never alter an existing report. Verify token revocation and reconnect behavior. Re-check the adapter against live responses; local fixtures do not substitute for this.
- Receive exactly one chosen reminder channel for an attending practice, and none for a decline, unknown attendance, an existing report, a skipped outing or paused reminders. Test a rescheduled practice, expired reminder, snooze and transient provider failure. Test push on an installed iPhone PWA and a desktop browser.
- Confirm forecast timestamps, a unavailable provider response, stale/expired display, historical enrichment, and archive reads. Inspect worker failures through the admin health endpoint and Supabase logs.
- Run and restore an encrypted backup into an isolated environment. Confirm the recovery key and BHC encryption key are stored independently of the services being backed up.
- Review database and weather-storage use against free-tier quotas at 70% and 85%; also review Supabase egress/invocations, Resend usage and GitHub artifact storage in their dashboards. The app’s health endpoint exposes database/storage sizes, recent weather and failed jobs; provider-wide billing meters are dashboard checks.
- Record real phone logging times for prefilled and independent outings. Targets are roughly 10 and 20 seconds respectively. The browser sample flow verifies functionality, not those human usability targets.

Do not promote learned forecasts just to demonstrate the feature. The initial release is useful with Hannah’s rule while observations accumulate.
