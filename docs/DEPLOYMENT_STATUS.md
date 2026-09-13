# Deployment status — September 13, 2026

The backend is deployed to Supabase project `exhoyifhvultmjryisce` in `us-west-2`.

Completed and verified:

- All 11 database migrations applied.
- `api` and `jobs` Edge Functions deployed with explicit dependency maps.
- Hosted Auth public signup disabled; both localhost development origins configured.
- Public browser key saved in ignored `.env.local`.
- BHC encryption key and job secret generated and installed as Edge Function secrets. The local recovery copy is ignored `.env.server.local` with owner-only file permissions. Move a recovery copy into the owner's password manager before pilot launch.
- Job secret and project URL stored in Vault; dispatcher scheduled every five minutes.
- Scheduled dispatcher HTTP response verified as 200, with a weather run and gzip archive object stored.
- Owner's administrator account created and approved without sending email.
- Real Open-Meteo collection completed and the public endpoint returned 192 hourly points.
- Unauthorized account/dispatcher requests and anonymous raw-table reads rejected.
- Production build, 37 TypeScript tests, 8 Python tests, and Edge Function type checks pass.

The first hosted weather upload exposed an SDK behavior: uploading a Blob can send its own generic MIME type instead of the explicit gzip option. Uploading compressed ArrayBuffer bytes fixes this while preserving the archive bucket's gzip-only restriction. Worker errors now identify a safe, fixed weather stage without recording credentials or provider response bodies.

Not yet completed:

- Custom SMTP and reminder email sender. Supabase rejected the OTP email template update because free projects using its default sender cannot customize templates. The template is prepared in `supabase/templates/magic_link.html`; apply it after custom SMTP is configured. No test emails have been sent.
- Cloudflare Pages frontend deployment and production origin settings. The frontend remains local; server `APP_URL` currently points to localhost.
- VAPID keys and real-device push delivery.
- Hosted account/report/BHC end-to-end checks.
- GitHub backup/training secrets, activation, and a restore drill.

No real rowing observations or BHC tokens have been imported. No learned model is active.
