import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  secrets,
  saveSecrets,
  management,
  assertStaging,
  query,
  literal,
  supabase,
  wrangler,
  root,
  readEnv,
  run,
} from "./lib.mjs";

export async function migrate() {
  await assertStaging();
  await query(
    "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key, statements text[], name text)",
  );
  const applied = new Set(
    (
      await query(
        "select version from supabase_migrations.schema_migrations",
        true,
      )
    ).map((x) => x.version),
  );
  for (const file of readdirSync(resolve(root, "supabase/migrations"))
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()) {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    if (applied.has(version)) continue;
    const sql = readFileSync(
      resolve(root, "supabase/migrations", file),
      "utf8",
    );
    await query(
      `begin; ${sql}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(${literal(version)},${literal(rest.join("_"))},array[${literal(sql)}]); commit;`,
    );
    console.log("Applied " + file);
  }
}
export async function configure() {
  const c = await assertStaging();
  let s = secrets();
  const keys = await management(`/projects/${c.supabase_ref}/api-keys`);
  const anon = keys.find((k) => k.name === "anon")?.api_key,
    service = keys.find((k) => k.name === "service_role")?.api_key;
  if (!anon || !service) throw new Error("Legacy project keys unavailable.");
  const owner = await management(
    `/projects/${c.production_supabase_ref}/database/query/read-only`,
    "POST",
    {
      query:
        "select u.email from auth.users u join public.profiles p on p.id=u.id where lower(trim(p.display_name))='graham findlay'",
    },
  );
  if (owner.length !== 1)
    throw new Error("Could not identify the sole approved owner.");
  const sender = readEnv(
    process.env.STAGING_SENDER_ENV ||
      "/Users/graham/projects/mendocean/.env.server.local",
  );
  if (!sender.RESEND_API_KEY || !sender.EMAIL_FROM)
    throw new Error("Existing verified sending configuration is missing.");
  s = {
    ...s,
    STAGING_SUPABASE_ANON_KEY: anon,
    STAGING_SUPABASE_SERVICE_KEY: service,
    STAGING_OWNER_EMAIL: owner[0].email,
    APP_URL: c.app_url,
    ALLOWED_ORIGINS: c.app_url,
    BHC_LINEUPS_ENABLED: "true",
    BHC_PASSWORD_CONNECT_ENABLED: "false",
    RESEND_API_KEY: sender.RESEND_API_KEY,
    EMAIL_FROM: sender.EMAIL_FROM.replace("Mendocean", "Mendocean Test"),
    VAPID_SUBJECT: "mailto:" + owner[0].email,
    OWNER_DIGEST_ENABLED: "false",
  };
  saveSecrets(s);
  const names = [
    "APP_URL",
    "ALLOWED_ORIGINS",
    "BHC_LINEUPS_ENABLED",
    "BHC_PASSWORD_CONNECT_ENABLED",
    "BHC_ENCRYPTION_KEY",
    "JOBS_SECRET",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
    "OWNER_DIGEST_ENABLED",
  ];
  await management(
    `/projects/${c.supabase_ref}/secrets`,
    "POST",
    names.map((name) => ({ name, value: s[name] })),
  );
  await management(`/projects/${c.supabase_ref}/config/auth`, "PATCH", {
    site_url: c.app_url,
    uri_allow_list: c.app_url,
    disable_signup: true,
    external_email_enabled: true,
    mailer_autoconfirm: false,
    smtp_admin_email: "hello@mail.mendocean.fyi",
    smtp_host: "smtp.resend.com",
    smtp_port: "465",
    smtp_user: "resend",
    smtp_pass: s.RESEND_API_KEY,
    smtp_sender_name: "Mendocean Test",
    mailer_subjects_magic_link: "Your Mendocean Test sign-in code",
    mailer_templates_magic_link_content: readFileSync(
      resolve(root, "supabase/templates/magic_link.html"),
      "utf8",
    ).replaceAll("Mendocean", "Mendocean Test"),
  });
  console.log(
    "Configured separate staging auth, push, secrets and exact origin; production sender reused.",
  );
}
export async function deployBackend() {
  const c = await assertStaging();
  supabase([
    "functions",
    "deploy",
    "api",
    "jobs",
    "--project-ref",
    c.supabase_ref,
    "--no-verify-jwt",
    "--use-api",
  ]);
  console.log("Deployed api and jobs to " + c.supabase_name + ".");
}
export async function deployFrontend() {
  const c = await assertStaging(),
    s = secrets();
  if (!s.STAGING_SUPABASE_ANON_KEY) throw new Error("Run configure first.");
  // Build with only staging public variables, overriding any local production env file.
  const env = {
    VITE_SUPABASE_URL: c.supabase_url,
    VITE_SUPABASE_ANON_KEY: s.STAGING_SUPABASE_ANON_KEY,
    VITE_VAPID_PUBLIC_KEY: s.VAPID_PUBLIC_KEY,
    VITE_STAGING: "true",
    VITE_TELEMETRY_ENABLED: "false",
    POSTHOG_SOURCEMAPS_UPLOAD: "false",
    VITE_POSTHOG_TOKEN: "",
    POSTHOG_CLI_API_KEY: "",
    VITE_BUILD_SHA: run("git", ["rev-parse", "HEAD"]).trim(),
  };
  run("npm", ["run", "build", "--", "--mode", "staging"], env);
  const html = readFileSync(resolve(root, "dist/index.html"), "utf8");
  if (!html.includes("Mendocean Test"))
    throw new Error("Staging marker missing from build.");
  try {
    wrangler([
      "pages",
      "project",
      "create",
      c.pages_project,
      "--production-branch",
      "staging",
    ]);
  } catch {
    console.log("Pages creation skipped; checking target identity.");
  }
  const list = wrangler(["pages", "project", "list", "--json"]);
  if (
    !JSON.parse(list).some(
      (p) => (p.name ?? p["Project Name"]) === c.pages_project,
    )
  )
    throw new Error("Staging Pages project unavailable.");
  wrangler([
    "pages",
    "deploy",
    "dist",
    "--project-name",
    c.pages_project,
    "--branch",
    "staging",
    "--commit-dirty=true",
  ]);
  console.log("Published staging frontend: " + c.app_url);
}
export async function setupFixtures() {
  const c = await assertStaging();
  let s = secrets();
  const headers = {
    apikey: s.STAGING_SUPABASE_ANON_KEY,
    Authorization: "Bearer " + s.STAGING_SUPABASE_SERVICE_KEY,
    "Content-Type": "application/json",
  };
  const existing = await query(
    "select owner_id from private.staging_environment",
    true,
  ).catch(() => []);
  let ownerId = existing[0]?.owner_id;
  if (!ownerId) {
    const matches = await query(
      `select id from auth.users where lower(email)=lower(${literal(s.STAGING_OWNER_EMAIL)})`,
      true,
    );
    if (matches.length > 1)
      throw new Error("Multiple staging owner accounts found.");
    ownerId = matches[0]?.id;
  }
  if (!ownerId) {
    const response = await fetch(c.supabase_url + "/auth/v1/admin/users", {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: s.STAGING_OWNER_EMAIL,
        email_confirm: true,
      }),
    });
    if (!response.ok)
      throw new Error(
        "Staging account creation failed (" + response.status + ").",
      );
    ownerId = (await response.json()).id;
  }
  if (!/^[0-9a-f-]{36}$/.test(ownerId))
    throw new Error("Invalid owner identifier.");
  await query(
    `update public.profiles set approved=true,display_name='Graham Findlay',role='member' where id=${literal(ownerId)};`,
  );
  await query(
    readFileSync(resolve(root, "scripts/staging/fixtures.sql"), "utf8"),
  );
  await query(
    `insert into private.staging_environment(owner_id) values(${literal(ownerId)}) on conflict(id) do update set owner_id=excluded.owner_id;`,
  );
  const { randomBytes } = await import("node:crypto");
  s = {
    ...s,
    STAGING_OWNER_ID: ownerId,
    STAGING_TEST_SECRET:
      s.STAGING_TEST_SECRET || randomBytes(32).toString("base64url"),
  };
  saveSecrets(s);
  await management(`/projects/${c.supabase_ref}/secrets`, "POST", [
    { name: "STAGING_MODE", value: "true" },
    { name: "STAGING_EXPECTED_URL", value: c.supabase_url },
    { name: "STAGING_OWNER_ID", value: ownerId },
    { name: "STAGING_TEST_SECRET", value: s.STAGING_TEST_SECRET },
  ]);
  console.log(
    "Created the sole approved staging owner and installed isolated fictional practice helpers.",
  );
}
export async function deployTestFunction() {
  const c = await assertStaging();
  supabase([
    "functions",
    "deploy",
    "staging-test",
    "--project-ref",
    c.supabase_ref,
    "--no-verify-jwt",
    "--use-api",
    "--import-map",
    "supabase/functions/deno.json",
  ]);
  console.log("Deployed staging-only scenario and delivery function.");
}
export async function trigger(action) {
  const c = await assertStaging(),
    s = secrets();
  const response = await fetch(c.supabase_url + "/functions/v1/staging-test", {
    method: "POST",
    headers: {
      apikey: s.STAGING_SUPABASE_ANON_KEY,
      Authorization: "Bearer " + s.STAGING_TEST_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      "Staging action failed (" + response.status + "): " + data.error,
    );
  console.log(JSON.stringify(data));
  return data;
}
export async function schedule() {
  const c = await assertStaging(),
    s = secrets();
  await query(`create extension if not exists pg_cron; create extension if not exists pg_net with schema extensions;
 do $$begin
 if exists(select 1 from vault.secrets where name='staging_project_url') then perform vault.update_secret((select id from vault.secrets where name='staging_project_url'),${literal(c.supabase_url)},'staging_project_url');else perform vault.create_secret(${literal(c.supabase_url)},'staging_project_url');end if;
 if exists(select 1 from vault.secrets where name='staging_test_secret') then perform vault.update_secret((select id from vault.secrets where name='staging_test_secret'),${literal(s.STAGING_TEST_SECRET)},'staging_test_secret');else perform vault.create_secret(${literal(s.STAGING_TEST_SECRET)},'staging_test_secret');end if;
 end $$;
 select cron.schedule('mendocean-staging-lineups','* * * * *',$cron$select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='staging_project_url')||'/functions/v1/staging-test',headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='staging_test_secret')),body := '{"action":"tick"}'::jsonb,timeout_milliseconds := 120000);$cron$);
 select cron.schedule('mendocean-staging-weather','*/15 * * * *',$cron$select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='staging_project_url')||'/functions/v1/staging-test',headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='staging_test_secret')),body := '{"action":"weather"}'::jsonb,timeout_milliseconds := 120000);$cron$);`);
  console.log(
    "Scheduled staging-only lineup delivery each minute and weather collection every 15 minutes. No BHC polling scheduled.",
  );
}
