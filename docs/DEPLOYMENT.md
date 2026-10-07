# Deployment

See [current deployment status](DEPLOYMENT_STATUS.md) before repeating setup steps.

For activity, browser diagnostics, external health checks and the weekly owner digest, see the [monitoring setup and recovery runbook](MONITORING.md).

## 1. Supabase project

Create a free project named **mendocean** in a nearby US region. Enable Data API, disable automatically exposing new tables, and enable automatic RLS. Save the database password in a password manager. GitHub linking is optional and is not needed here.

Install the Supabase CLI, authenticate locally, then:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy api --no-verify-jwt
supabase functions deploy jobs --no-verify-jwt
```

The gateway JWT check is off because `api` contains public routes. Every private API route explicitly verifies the user with Supabase Auth; `jobs` requires its separate secret. Do not remove these checks.

The migrations create the tables, policies, validated report RPCs, private weather bucket, queue and model metadata. They are not a substitute for hosted Auth settings: **disable public signups** in the dashboard too, or review `supabase config diff` and apply `supabase config push`. Editing `supabase/config.toml` alone does not change hosted Auth. Review the origin settings before pushing them to a production project.

Keep `[auth.email].enable_signup = true`: this controls email-provider availability in the hosted configuration. Block public registration with `[auth].enable_signup = false`. Verify `/auth/v1/settings` reports both `external.email: true` and `disable_signup: true`; a configuration diff alone does not prove sign-in works.

## 2. Frontend

In Cloudflare Pages, import `grahamfindlay/mendocean` when the implementation has been pushed. Use `npm run build`, output directory `dist`, and Node 24. Set these build variables:

- `VITE_SUPABASE_URL`: the project URL.
- `VITE_SUPABASE_ANON_KEY`: the public anon/publishable key.
- `VITE_VAPID_PUBLIC_KEY`: the public push key, once push is configured.

A `pages.dev` address is sufficient for the app. A separate domain is needed for a properly authenticated email sender. The app does not require `katahdin.me`.

Reference: [Cloudflare Pages Vite deployment](https://developers.cloudflare.com/pages/framework-guides/deploy-a-vite3-project/).

## 3. Server secrets and email

Set the names from `supabase/functions/.env.example` through Supabase secret management. Keep an independent recovery copy of the BHC encryption key. Generate separate cryptographically random values for `BHC_ENCRYPTION_KEY` (32 bytes, base64) and `JOBS_SECRET`; do not reuse API tokens for either.

Set `APP_URL` to the production origin, without a trailing slash. Set `ALLOWED_ORIGINS` to the explicit frontend origins. Preview branches should use a separate development project, or stay unconnected. Do not grant every preview origin access to production by wildcard.

Verify an email-sending domain in Resend. Configure Supabase Auth custom SMTP with that provider. Set the **Magic Link** email template to include `{{ .Token }}` so the user receives the code the app expects. Set the Auth site URL and allowed redirects to the production origin. Test with Graham’s account before inviting others. Set `RESEND_API_KEY` and `EMAIL_FROM` separately for reminder delivery.

For push, generate a VAPID pair and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a contact mailto address). The public half also goes into the frontend build. A phone must grant notification permission; iPhone web push is tested after adding the app to the Home Screen.

## 4. First administrator

Create Graham’s user in Supabase Authentication. Then, using that user’s UUID, run:

```sql
update public.profiles set role = 'admin', approved = true where id = 'USER_UUID';
```

Administration → Accounts & activity (`/admin/accounts`) lets the administrator create additional invited accounts without sending unsolicited invitation emails. Invitees can request their own sign-in code. BHC tokens are connected separately by each user through Account.

## 5. Scheduled jobs

Create two Supabase Vault entries: `mendocean_project_url` and `mendocean_jobs_secret`. The second must match the Edge Function’s `JOBS_SECRET`. Run `supabase/setup_cron.sql` once. It schedules a dispatcher every five minutes; each queued action has its own due time and deduplication key. Re-running the named schedule updates the same cron job.

Run a first dispatch, then confirm that public weather appears and that scheduled invocations succeed. The dispatcher fetches weather every 15 minutes, polls BHC daily during the 16:00 Madison hour, and runs deadline/start/end refreshes already in the queue.

Reference: [Supabase scheduling with Cron, pg_net and Vault](https://supabase.com/docs/guides/functions/schedule-functions).

## 6. Backups and training

Create an age encryption key pair. Store the **private recovery key outside GitHub and Supabase**, such as in your password manager. GitHub needs only its public recipient.

GitHub Actions secrets:

| Name                        | Purpose                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | Project endpoint                                                                  |
| `JOBS_SECRET`               | Private training export and shadow import                                         |
| `DATABASE_URL`              | Direct or session-pooler database connection; avoid transaction pooling for dumps |
| `AGE_RECIPIENT`             | Public age encryption recipient                                                   |
| `SUPABASE_SERVICE_ROLE_KEY` | Read private weather objects for encrypted backup                                 |

Set repository variable `PILOT_ENABLED=true` only after these are configured. Run both workflows manually first. Backups retain seven daily encrypted database artifacts; the weekly weather export is complete, not incremental. Training downloads only the fields it needs into an ephemeral runner, removes them afterward, and stores coefficients privately as a shadow model. It never publishes automatically.

Test recovery into an isolated disposable database/project before launch. Decrypt with the separately held age private key, inspect the custom-format dump with `pg_restore --list`, and restore the application and auth data against matching schemas. Supabase-managed schemas require care; do not point a restore command at the live pilot. Restore weather objects from the encrypted tar. Reapply service secrets and validate the two-user privacy checks, sign-in, report counts, and weather archive reads. A successful backup upload alone is not a restore test.

## 7. Model review

The admin-only health endpoint lists shadow model IDs and validation metrics. Review eligibility, chronological holdout, calibration, outcome balance and sample sizes. Publishing is an explicit admin call to `models/publish` with the chosen ID. The database rejects a model trained against an older data revision. `models/rollback` retires the active model and returns forecasts to Hannah’s rule.

New reports can accumulate between weekly fits; edits and deletions retire an active model. No model is approved or active on initial deployment.

## BHC connection rollout

The guided API-key flow and optional password exchange are implemented in [the connection plan](BHC_CONNECTION_PLAN.md). Deploy migration `202610070001_bhc_connection.sql`, then the `api` and `jobs` functions, then the frontend. Keep `BHC_PASSWORD_CONNECT_ENABLED=false` initially; it defaults to disabled when unset. This flag controls new password exchanges; existing generated tokens continue to validate normally.

Pin Mendota once before member rollout. Either set the verified numeric `BHC_MENDOTA_CLUB_ID` in function secrets, or have a Mendocean administrator connect a BHC account with exactly one membership whose name contains `mendota` (case insensitive). That first match is pinned in `private.bhc_settings`; subsequent connections check the numeric ID even if BHC renames the club. Regular members cannot configure it. Do not use synthetic fixture ID `1` in production. A conflicting environment ID is rejected instead of overwriting the pinned value. Existing connections to another club become membership problems when configuration is pinned, preserving all outings and reports.

Before enabling password exchange, verify the documented request, rejected-credential/expiry response semantics and recurring six-month use with BHC using a deliberate test account. Verify the signed-in My Profile link and token-creation instructions on desktop and a physical mobile device. Then enable `BHC_PASSWORD_CONNECT_ENABLED=true` for the intended release. Local fixtures test these paths without contacting BHC; they do not establish real-provider or password-manager behavior. The UI shows the password option as unavailable while the flag is disabled.

Live failure checks on October 7, 2026 confirmed HTTP 200 error objects rather than the documented empty arrays: rejected credentials return `status: "Error"` with `error: "email, or password incorrect"`; rejected tokens return `status: "error"`, null token/customer IDs, and the message `Token was not found, or is expired. Do not attempt to re-use this token.` The adapter recognizes these specific responses; other unexpected errors remain temporary failures. The integration fixtures reproduce these envelopes without retaining credentials.

The owner's deliberate live test on October 7, 2026 verified successful password exchange, token validation, Mendota ID 2362, Unix-second expiry metadata, deletion of newly generated test tokens and rejection after deletion. BHC returned a 365-day expiry rather than the documented six months. Mendocean uses the actual expiry; renewal copy avoids a fixed duration. No Mendocean connection, practice, attendance or notification was changed by the live test. Physical-device password-manager behavior and invalidation following a real email/password change were not tested.

To repeat the live test, run `deno run --config supabase/functions/deno.json --allow-net=127.0.0.1:5184,api.boathouseconnect.com --allow-env scripts/bhc-password-contract.ts`. Open the printed local URL and enter the BHC login directly into the form. The check uses the production adapter, verifies Mendota ID 2362 and expiry metadata, and never writes to Mendocean. It deletes only a test token whose provider creation timestamp confirms it was newly generated during the test, then checks rejection after deletion. Credentials and tokens are never printed or persisted. If creation or cleanup is unconfirmed, review the BHC profile manually; do not repeat the exchange automatically. The form stops after twenty minutes or three attempts.

Known expiry or verified rejection pauses BHC sync, attendance writes and official-practice reminders. Temporary provider failures retain the connection and show stale-data status. Reminder reservation and final delivery require current connection state and a practice refresh after its end. Reconnect replaces credentials atomically, imports current practices and never replays an attendance write. Disconnect erases encrypted credentials while retaining a non-secret revision tombstone and rowing history. It does not revoke tokens at BHC; users can delete their dedicated token in My Profile.

For rollback, disable new password exchanges and retain this migration. Old frontend clients can continue using `bhc/connect` with a provided token, but any supplied club ID must equal Mendota's. Use the new API/workers with the schema; pre-migration workers do not contain the expiry and revision enforcement.
