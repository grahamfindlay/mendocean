# Deployment status — September 14, 2026

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
- Production build, 37 TypeScript tests, 8 Python tests, and Edge Function type checks pass. All 6 desktop/mobile browser tests pass in GitHub Actions.
- Frontend published at https://mendocean.fyi and live weather rendering verified. Pages is connected to `codex/mendocean-pilot`, currently its production branch; switch to `main` when the implementation is merged. Preview branch deployments are disabled.
- Production origins and Auth site URL configured. Resend sending-only key, SMTP, and OTP template installed. Sender is `hello@mail.mendocean.fyi`. SMTP authentication succeeds and Resend has verified all four email DNS records.
- Web Push keys configured in Supabase and the frontend; real-device delivery is not yet tested.

The first hosted weather upload exposed an SDK behavior: uploading a Blob can send its own generic MIME type instead of the explicit gzip option. Uploading compressed ArrayBuffer bytes fixes this while preserving the archive bucket's gzip-only restriction. Worker errors now identify a safe, fixed weather stage without recording credentials or provider response bodies.

Not yet completed:

- End-to-end sign-in email delivery: domain verification and SMTP authentication pass, but no test email has been sent. The temporary Resend setup key was revoked and removed from the local setup file; production uses its separate sending-only key.
- Real-device push delivery.
- Hosted account/report/BHC end-to-end checks.
- GitHub backup/training secrets, activation, and a restore drill.

No real rowing observations or BHC tokens have been imported. No learned model is active.

The custom domain uses Cloudflare DNS and HTTPS. The old `mendocean.pages.dev` address redirects in the browser to the new domain, preserving path, query, and fragment. No katahdin.me DNS changes are required.
