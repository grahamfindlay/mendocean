# Automated testing

## Commands and coverage

| Command | What it verifies | Services |
| --- | --- | --- |
| `npm test` | Rules, client behavior, PGlite SQL permissions/transactions, smoke failure conditions | None |
| `npm run build` | Type checks and production compilation | None |
| `npm run test:e2e` | Existing preview UI scenarios | Development preview and synthetic weather |
| `npm run test:stack` | Fresh migrations, Auth, API, jobs, storage, upstream failures, then production-build browser journeys | Disposable local Supabase containers + fixture server |
| `npm run test:smoke` | Live public API, weather freshness, unsigned-access rejection, assets | Read-only production access |
| `npx playwright test --config playwright.smoke.config.ts` | Live forecast rendering and navigation | Read-only production browser |

Run `npm ci` first. The full stack requires a running Docker-compatible container runtime and Playwright browsers (`npx playwright install chromium webkit`; Linux CI uses `--with-deps`). No hosted Supabase credentials are needed. Use one full-stack run per host: ports 54321, 54322, 54324, 54328, and 4175 must be available. The harness uses a unique temporary project, and cleans up only its own containers/volumes on completion or interruption.

`test:integration` and `test:e2e:full` are child commands of the harness; they deliberately refuse to run without the local-only test environment. Do not configure them against a hosted project. The harness generates configuration in a temporary directory, ignores the owner's `.env` files, and captures Auth email in Mailpit. A local service-role key is used for fixtures and inspection; user actions use ordinary sessions. BHC, weather, Resend, and push responses are synthetic upstream adapters selected only by test composition roots. No request parameter can enable them in production.

The browser suite runs a production Vite build against the real local API. The `?preview=1` flag must not bypass authentication. Chromium and WebKit are desktop engines; the phone project is explicitly Chromium mobile emulation. Persistent-profile restart tests run in Chromium. Neither establishes installed iPhone PWA behavior or actual OS notification display.

## Failure interpretation

GitHub Actions has independent `fast` and `full-stack` jobs. Product assertion failures are not retried automatically. The harness prints stage names and redacts known secrets/JWTs from diagnostics. Full-stack traces and screenshots are disabled because they could contain session headers or sign-in codes; test names, assertions, and sanitized process output remain in Actions logs. Enable detailed local tracing only with synthetic accounts and do not upload raw session artifacts.

Smoke failures distinguish frontend availability, API availability, authorization regressions, and weather freshness. Weather older than 90 minutes is a smoke failure even if the API returns HTTP 200. Deterministic validator tests intentionally exercise stale forecasts and unexpected HTTP 200 responses on private endpoints; do not break production to test alarms.

`EXPECTED_SHA` makes the smoke command wait up to ten minutes for the exact deployed `build.json` commit before checking behavior. `SMOKE_PUBLIC_KEY` supplies the public Supabase key for Auth-settings verification; it is not an administrator credential. The smoke workflow's repository variable must be configured before counting that check as active. Without it, the command explicitly reports that Auth settings were not checked.

Scheduled workflows run from GitHub's default branch. The production branch is currently `codex/mendocean-pilot`; adding a schedule to another branch alone does not activate it. Verify the default-branch workflow, deployment event environment name, repository variable, and required release checks when activating production smoke. Never treat merely committed workflow files as active monitoring.

## Limited live acceptance

- Owner confirmed successful login and desktop push delivery on September 14, 2026.
- Compare one real BHC practice and posted lineup against the app.
- Observe one opted-in scheduled reminder and its link during ordinary practice use.
- Check installed iPhone PWA reopening/offline behavior if that is a supported device.
- Optional read-only BHC contract check: `node scripts/bhc-contract.mjs`, with `BHC_CONTRACT_TOKEN` supplied through a protected process environment and `BHC_CONTRACT_CLUB_ID` only for accounts with multiple clubs. It makes at most five allowlisted reads and prints no provider payloads or tokens. Never add the owner's token to ordinary CI.

Backup activation/restore validation and learned-model activation are separate tasks; passing application tests does not establish either.
