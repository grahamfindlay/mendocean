# Mendocean

Lake Mendota rowing forecasts and a quick record of what actually happened on the water. Inspired by [Hannah Wayment-Steele’s original forecast](https://github.com/HWaymentSteele/mendota-weather).

The implementation uses React, TypeScript and Vite for the website, Supabase for authentication/database/background work, and Cloudflare Pages for hosting. It is designed for an invite-only pilot with public forecasts.

## Run locally

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. Public weather works without a Supabase project: the development server fetches and caches Open-Meteo weather. Production requires the configured server and scheduled weather collector.

For a **clearly labeled local sample account**, open `/?preview=1`. Reports in this mode stay on the device, and no account or BHC credentials are used. This fixture adapter is excluded from the production build.

To connect a real project, copy `.env.example` to `.env.local`, supply the project URL and public anon/publishable key, and restart Vite. Never place a service-role key or BHC token in a `VITE_` variable.

## What is implemented

- Public current/hourly weather and a five-day planner with arbitrary start times and practice windows.
- Hannah’s exact wind rule, unrounded classification, explicit missing/stale/expired states, and attribution.
- Email-code sign-in, invited writers, independent outings, shared outing links, and per-user reports.
- Water ratings, routes and optional route segments, coaching, boat classes and fleet extremes, date/time corrections, editing, deletion, and personal export.
- Device drafts and retryable uploads. A local save is distinguished from server persistence.
- Read-only BHC imports, encrypted tokens, attendance deadlines, deduplicated planned coaches, and occupied-lineup boat extraction. Planned imports never overwrite reports.
- Scheduled reminder jobs with email or push, suppression, retries, expiry, and a reserved email budget.
- Immutable private weather archives and asynchronous historical enrichment.
- Separate launch and ordinal-water models, outing weights, chronological day-grouped validation, personal-only fitting, optional qualified contexts, shadow publication, and rollback to the rule.
- Database isolation tests, CI checks, encrypted daily backups and weekly complete weather exports.

## Checks

```sh
npm test
npm run build
python3 -m unittest discover -s tests -p 'test_*.py'
deno check --config supabase/functions/deno.json supabase/functions/api/index.ts supabase/functions/jobs/index.ts
```

Database tests execute the SQL migrations in embedded PostgreSQL (PGlite) and exercise real roles, RLS, transactions and constraints. Supabase-owned Auth/Storage schemas are minimal test fixtures; hosted Auth, email delivery, Cron, web push, and backup restoration require deployment checks. Browser checks use the running local app and an explicit sample account.

## Deployment and operation

See [deployment instructions](docs/DEPLOYMENT.md), [implementation notes](docs/IMPLEMENTATION.md), and [pilot launch checks](docs/PILOT.md).

The code has not been deployed to a hosted Supabase project or Cloudflare Pages yet. No real BHC token is committed, no pilot accounts have been created, and reminder sending is not enabled locally.
