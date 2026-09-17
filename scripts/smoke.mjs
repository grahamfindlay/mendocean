import {
  validateForecast,
  requireDenied,
  validateAuth,
} from "../tests/smoke/checks.mjs";
import publicConfig from "../tests/smoke/public-config.json" with { type: "json" };
import { createHash } from "node:crypto";
const site = "https://mendocean.fyi";
const backend = "https://exhoyifhvultmjryisce.supabase.co";
const expected = process.env.EXPECTED_SHA;
async function get(url, init) {
  const r = await fetch(url, {
    ...init,
    headers: { "User-Agent": "Mendocean-Smoke/1.0", ...init?.headers },
    signal: AbortSignal.timeout(15000),
  });
  return r;
}
const deadline = Date.now() + 10 * 60000;
if (expected) {
  while (true) {
    let build;
    try {
      const r = await get(site + "/build.json");
      if (r.ok) build = await r.json();
    } catch {}
    if (build?.commit === expected) break;
    if (Date.now() > deadline)
      throw new Error(
        "deployment: expected commit not live within ten minutes",
      );
    await new Promise((r) => setTimeout(r, 10000));
  }
}
const page = await get(site);
if (!page.ok) throw new Error("frontend: unavailable");
const html = await page.text();
if (!html.includes("Mendocean"))
  throw new Error("frontend: unexpected document");
const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
if (!asset || !(await get(site + asset)).ok)
  throw new Error("frontend: entry asset missing");
const worker = await get(site + "/sw.js");
if (!worker.ok) throw new Error("frontend: service worker unavailable");
const release = JSON.parse(
  (await worker.text()).match(/^const RELEASE = (.+);$/m)?.[1] || "null",
);
if (
  !release?.id ||
  !release.assets?.length ||
  (expected && release.commit !== expected)
)
  throw new Error("frontend: service worker release identity mismatch");
if (!html.includes(`content="${release.id}"`))
  throw new Error("frontend: HTML and worker releases differ");
for (const asset of release.assets) {
  if (!asset.url.startsWith("/") || asset.url.startsWith("//"))
    throw new Error("frontend: invalid precache URL");
  const response = await get(site + asset.url);
  const digest = createHash("sha256")
    .update(Buffer.from(await response.arrayBuffer()))
    .digest("hex");
  if (!response.ok || digest !== asset.hash)
    throw new Error(
      "frontend: deployed precache integrity failed for " + asset.url,
    );
}
const forecast = await get(backend + "/functions/v1/api/weather");
if (!forecast.ok) throw new Error("weather-api: unavailable");
validateForecast(await forecast.json());
for (const path of ["account", "export"])
  requireDenied((await get(backend + "/functions/v1/api/" + path)).status);
for (const path of ["report", "push/test", "bhc/attendance"])
  requireDenied(
    (
      await get(backend + "/functions/v1/api/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
  );
requireDenied(
  (
    await get(backend + "/functions/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"action":"tick"}',
    })
  ).status,
);
// A public publishable key is needed for Auth settings, but no session/admin secret.
const key = process.env.SMOKE_PUBLIC_KEY || publicConfig.supabasePublicKey;
if (key) {
  const settings = await get(backend + "/auth/v1/settings", {
    headers: { apikey: key },
  });
  if (!settings.ok) throw new Error("auth-settings: unavailable");
  validateAuth(await settings.json());
} else throw new Error("auth-settings: public key missing");
console.log(
  "Production read-only smoke checks passed" +
    (expected ? " for " + expected : ""),
);
