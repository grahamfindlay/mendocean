# Deployment

See [current deployment status](DEPLOYMENT_STATUS.md) before repeating setup steps.

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

The app’s Account screen lets the administrator create additional invited accounts without sending unsolicited invitation emails. Invitees can request their own sign-in code. BHC tokens are connected separately by each user through Account.

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
