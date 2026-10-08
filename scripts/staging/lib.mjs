import { readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes, createECDH } from "node:crypto";
import { resolve } from "node:path";
export const root = resolve(import.meta.dirname, "../..");
export const configPath = resolve(root, "staging.config.json");
export const secretsPath = resolve(root, ".env.staging.local");
export const config = () => JSON.parse(readFileSync(configPath, "utf8"));
export function readEnv(path) {
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match)
      result[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return result;
}
export const secrets = () => readEnv(secretsPath);
export function saveSecrets(values) {
  if (Object.values(values).some((v) => /[\r\n]/.test(String(v))))
    throw new Error("Multiline secret refused.");
  writeFileSync(
    secretsPath,
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  chmodSync(secretsPath, 0o600);
}
export function saveConfig(values) {
  writeFileSync(configPath, JSON.stringify(values, null, 2) + "\n");
}
let credential;
function managementToken() {
  if (!credential)
    credential =
      process.env.SUPABASE_ACCESS_TOKEN ||
      execFileSync(
        "security",
        ["find-generic-password", "-s", "Supabase CLI", "-w"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
  return credential;
}
export async function management(path, method = "GET", body) {
  const response = await fetch("https://api.supabase.com/v1" + path, {
    method,
    headers: {
      Authorization: `Bearer ${managementToken()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(
      `Supabase management ${method} ${path} failed (${response.status}); response withheld.`,
    );
  const payload = await response.text();
  return payload ? JSON.parse(payload) : null;
}
let verified;
export function validateStagingConfig(c) {
  if (
    !c.supabase_ref ||
    c.supabase_ref === "exhoyifhvultmjryisce" ||
    c.supabase_ref === c.production_supabase_ref ||
    c.supabase_url !== `https://${c.supabase_ref}.supabase.co` ||
    !c.supabase_name?.endsWith("-staging") ||
    c.pages_project === "mendocean" ||
    !c.pages_project?.endsWith("-staging") ||
    ["mendocean.fyi", "mendocean.pages.dev"].includes(
      new URL(c.app_url).hostname,
    ) ||
    new URL(c.app_url).protocol !== "https:"
  )
    throw new Error("Refusing a non-staging target.");
}
export async function assertStaging() {
  const c = config();
  validateStagingConfig(c);
  if (verified !== c.supabase_ref) {
    const p = await management("/projects/" + c.supabase_ref);
    if (p.name !== c.supabase_name || p.organization_id !== c.organization_slug)
      throw new Error("Staging project identity mismatch.");
    verified = c.supabase_ref;
  }
  return c;
}
export async function query(sql, readOnly = false) {
  const c = await assertStaging();
  return management(
    `/projects/${c.supabase_ref}/database/query${readOnly ? "/read-only" : ""}`,
    "POST",
    { query: sql },
  );
}
export function run(binary, args, extraEnv = {}) {
  try {
    return execFileSync(binary, args, {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 240000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    throw new Error(
      `${binary.split("/").pop()} ${args[0] ?? ""} failed; diagnostics withheld to protect credentials.`,
    );
  }
}
export const supabase = (args, extraEnv = {}) =>
  run(resolve(root, "node_modules/.bin/supabase"), args, extraEnv);
export const wrangler = (args) =>
  run(resolve(root, "node_modules/.bin/wrangler"), args, {
    CLOUDFLARE_ACCOUNT_ID: config().cloudflare_account_id,
  });
export const literal = (v) => "'" + String(v).replaceAll("'", "''") + "'";
export async function initialize() {
  const c = config();
  if (c.supabase_ref && !existsSync(secretsPath))
    throw new Error(
      "Restore the staging recovery file before reusing the existing environment; refusing to replace its keys.",
    );
  const org = await management("/organizations/" + c.organization_slug);
  if (org.plan !== "free")
    throw new Error(
      "Automatic provisioning only supports the free organization plan; review costs before continuing.",
    );
  let s = existsSync(secretsPath) ? secrets() : {};
  if (!s.STAGING_DATABASE_PASSWORD) {
    const ec = createECDH("prime256v1");
    ec.generateKeys();
    s = {
      ...s,
      STAGING_DATABASE_PASSWORD: randomBytes(32).toString("base64url"),
      BHC_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      JOBS_SECRET: randomBytes(32).toString("base64url"),
      VAPID_PUBLIC_KEY: ec.getPublicKey().toString("base64url"),
      VAPID_PRIVATE_KEY: ec.getPrivateKey().toString("base64url"),
    };
    saveSecrets(s);
  }
  const projects = await management("/projects");
  const matches = projects.filter(
    (p) =>
      p.name === c.supabase_name && p.organization_id === c.organization_slug,
  );
  if (matches.length > 1)
    throw new Error(
      "Multiple staging projects found; resolve identity before continuing.",
    );
  let p = matches[0];
  if (!p) {
    console.log("Creating isolated Supabase project on the free plan.");
    p = await management("/projects", "POST", {
      organization_slug: c.organization_slug,
      name: c.supabase_name,
      db_pass: s.STAGING_DATABASE_PASSWORD,
      region_selection: { type: "specific", code: c.region },
    });
  }
  if (c.supabase_ref && c.supabase_ref !== (p.id ?? p.ref))
    throw new Error("Existing staging reference mismatch.");
  c.supabase_ref = p.id ?? p.ref;
  c.supabase_url = `https://${c.supabase_ref}.supabase.co`;
  saveConfig(c);
  console.log(
    JSON.stringify({
      project: c.supabase_name,
      ref: c.supabase_ref,
      status: p.status,
    }),
  );
  console.log(
    "Provisioning recorded. Run status before configuring the database.",
  );
}
export async function status() {
  const c = config();
  const p = await management("/projects/" + c.supabase_ref);
  console.log(
    JSON.stringify({ name: p.name, ref: p.id ?? p.ref, status: p.status }),
  );
}
