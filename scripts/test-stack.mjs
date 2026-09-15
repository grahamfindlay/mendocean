import { spawn, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { startFixtures } from "../tests/support/fixture-server.mjs";
const root = resolve(".");
const work = mkdtempSync(join(tmpdir(), "mendocean-test-"));
const id = "mendocean-test-" + randomBytes(4).toString("hex");
const cli = join(root, "node_modules/.bin/supabase");
const safeEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) =>
      !/^(SUPABASE|VITE_|RESEND|BHC_|JOBS_|VAPID_|DATABASE_URL|PGPASSWORD|PGHOST|APP_URL|ALLOWED_ORIGINS|CLOUDFLARE)/.test(
        k,
      ),
  ),
);
let env = { ...safeEnv };
const children = [];
let fixtures;
let cleanupStarted = false;
const sensitive = [];
const diagnostics = [];
const redact = (text) =>
  sensitive
    .reduce((s, k) => (k ? s.split(k).join("[redacted]") : s), String(text))
    .replace(/eyJ[A-Za-z0-9_.-]+/g, "[redacted JWT]")
    .replace(
      /^.*"(?:DB_URL|SERVICE_ROLE_KEY)".*$/gm,
      "[local stack credentials omitted]",
    );
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, env, ...opts });
    let output = "";
    let stdout = "";
    child.stdout?.on("data", (b) => {
      output += b;
      stdout += b;
    });
    child.stderr?.on("data", (b) => {
      output += b;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!args.includes("status")) diagnostics.push(redact(output));
      if (code === 0) resolve(stdout);
      else {
        console.error(redact(output));
        reject(new Error(`${cmd.split("/").pop()} failed (${code})`));
      }
    });
  });
}
function background(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: root, env, ...opts });
  children.push(child);
  let log = "";
  child.stdout?.on("data", (b) => (log += b));
  child.stderr?.on("data", (b) => (log += b));
  child.on("error", (e) => console.error(e.message));
  child.diagnostic = () => redact(log);
  return child;
}
async function ready(url, headers = {}, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(2000),
      });
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Readiness deadline exceeded: " + new URL(url).pathname);
}
async function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  for (const c of children) c.kill("SIGTERM");
  fixtures?.close();
  try {
    execFileSync(cli, ["stop", "--workdir", work, "--no-backup"], {
      env,
      stdio: "ignore",
      timeout: 60000,
    });
  } catch {}
  rmSync(work, { recursive: true, force: true });
}
process.on("SIGINT", () => void cleanup().then(() => process.exit(130)));
process.on("SIGTERM", () => void cleanup().then(() => process.exit(143)));
try {
  await run("docker", ["info"]);
  mkdirSync(join(work, "supabase"), { recursive: true });
  for (const dir of ["migrations", "templates", "functions"])
    cpSync(join(root, "supabase", dir), join(work, "supabase", dir), {
      recursive: true,
      filter: (src) => !basename(src).startsWith(".env"),
    });
  cpSync(join(root, "shared"), join(work, "supabase/functions/_shared/app"), {
    recursive: true,
  });
  // The Edge Runtime mounts functions only. Preserve application sources inside that mount.
  function relocate(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) relocate(p);
      else if (p.endsWith(".ts"))
        writeFileSync(
          p,
          readFileSync(p, "utf8").replaceAll(
            "../../../shared/",
            "../_shared/app/",
          ),
        );
    }
  }
  relocate(join(work, "supabase/functions"));
  cpSync(
    join(root, "tests/support/fixture-provider.ts"),
    join(work, "supabase/functions/_shared/fixture-provider.ts"),
  );
  for (const name of ["api", "jobs"])
    writeFileSync(
      join(work, `supabase/functions/${name}/index.ts`),
      `import { create${name === "api" ? "Api" : "Jobs"}Handler } from './handler.ts';\nimport { fixtureProviders } from '../_shared/fixture-provider.ts';\nDeno.serve(create${name === "api" ? "Api" : "Jobs"}Handler(fixtureProviders));\n`,
    );
  writeFileSync(
    join(work, "supabase/config.toml"),
    `project_id = "${id}"
[api]
port = 54321
schemas = ["public"]
[db]
port = 54322
major_version = 17
[studio]
enabled = false
[local_smtp]
port = 54324
[auth]
site_url = "http://127.0.0.1:4175"
additional_redirect_urls = ["http://127.0.0.1:4175"]
enable_signup = false
[auth.rate_limit]
email_sent = 1000
[auth.email]
enable_signup = true
enable_confirmations = true
max_frequency = "1s"
[auth.email.template.magic_link]
subject = "Your Mendocean sign-in code"
content_path = "./supabase/templates/magic_link.html"
[analytics]
enabled = false
[functions.api]
verify_jwt = false
import_map = "./functions/deno.json"
[functions.jobs]
verify_jwt = false
import_map = "./functions/deno.json"
`,
  );
  console.log("Starting isolated Supabase stack (no hosted credentials).");
  await run(cli, ["start", "--workdir", work]);
  const status = JSON.parse(
    await run(cli, ["status", "--workdir", work, "-o", "json"]),
  );
  const local = new URL(status.API_URL);
  if (local.hostname !== "127.0.0.1" && local.hostname !== "localhost")
    throw new Error("Refusing nonlocal stack");
  const secret = randomBytes(24).toString("hex");
  sensitive.push(secret, status.SERVICE_ROLE_KEY, status.ANON_KEY);
  env = {
    ...env,
    TEST_STACK: "local-only",
    TEST_SUPABASE_URL: status.API_URL,
    TEST_ANON_KEY: status.ANON_KEY,
    TEST_SERVICE_KEY: status.SERVICE_ROLE_KEY,
    TEST_DATABASE_URL: status.DB_URL,
    TEST_MAIL_URL: status.INBUCKET_URL || "http://127.0.0.1:54324",
    TEST_FIXTURE_SECRET: secret,
    TEST_APP_URL: "http://127.0.0.1:4175",
    TEST_PROFILE_ROOT: work,
  };
  fixtures = await startFixtures(secret);
  const net = JSON.parse(
    execFileSync("docker", ["network", "inspect", `supabase_network_${id}`], {
      encoding: "utf8",
    }),
  );
  // Docker Desktop runs containers inside a VM; its gateway is not the host.
  const gateway = ["darwin", "win32"].includes(process.platform)
    ? "host.docker.internal"
    : net[0].IPAM.Config[0].Gateway;
  const functionEnv = `APP_URL=http://127.0.0.1:4175\nALLOWED_ORIGINS=http://127.0.0.1:4175\nJOBS_SECRET=${secret}\nBHC_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}\nRESEND_API_KEY=synthetic\nEMAIL_FROM=Mendocean <test@example.test>\nFIXTURE_SECRET=${secret}\nFIXTURE_URL=http://${gateway}:54328\n`;
  writeFileSync(join(work, "functions.env"), functionEnv, { mode: 0o600 });
  background(cli, [
    "functions",
    "serve",
    "--workdir",
    work,
    "--env-file",
    join(work, "functions.env"),
  ]);
  await ready(status.API_URL + "/functions/v1/api/account", {
    apikey: status.ANON_KEY,
  });
  // Build an isolated source copy so Vite cannot load the owner's ignored env files.
  const app = join(work, "app");
  mkdirSync(app);
  for (const item of [
    "src",
    "shared",
    "public",
    "index.html",
    "vite.config.ts",
    "package.json",
    "tsconfig.json",
    "tsconfig.app.json",
  ]) {
    try {
      cpSync(join(root, item), join(app, item), { recursive: true });
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const { symlinkSync } = await import("node:fs");
  symlinkSync(join(root, "node_modules"), join(app, "node_modules"), "dir");
  const buildEnv = {
    ...env,
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
    VITE_VAPID_PUBLIC_KEY: Buffer.concat([
      Buffer.from([4]),
      randomBytes(64),
    ]).toString("base64url"),
    VITE_BUILD_SHA: process.env.GITHUB_SHA || "local-test",
  };
  console.log("Building production frontend against isolated services.");
  await run(join(root, "node_modules/.bin/vite"), ["build"], {
    cwd: app,
    env: buildEnv,
  });
  background(
    join(root, "node_modules/.bin/vite"),
    ["preview", "--host", "127.0.0.1", "--port", "4175", "--strictPort"],
    { cwd: app, env: buildEnv },
  );
  await ready(env.TEST_APP_URL);
  console.log("Running real-backend integration tests.");
  console.log(await run("npm", ["run", "test:integration"]));
  console.log("Running production-build browser journeys.");
  console.log(await run("npm", ["run", "test:e2e:full"]));
} catch (e) {
  console.error(e.message);
  for (const c of children) console.error(c.diagnostic());
  mkdirSync(join(root, "test-results"), { recursive: true });
  writeFileSync(
    join(root, "test-results/stack.log"),
    redact(diagnostics.join("\n")),
  );
  process.exitCode = 1;
} finally {
  await cleanup();
}
