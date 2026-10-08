import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { assertStaging, secrets, query } from "./lib.mjs";
import { trigger } from "./deploy.mjs";
export async function testSession() {
  const c = await assertStaging(),
    s = secrets();
  const admin = createClient(c.supabase_url, s.STAGING_SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: s.STAGING_OWNER_EMAIL,
  });
  if (error || !data.properties.hashed_token)
    throw new Error("Could not generate staging-only test session.");
  const client = createClient(c.supabase_url, s.STAGING_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await client.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verified.error || !verified.data.session)
    throw new Error("Could not verify staging-only test session.");
  return { client, session: verified.data.session };
}
export async function assets() {
  const c = await assertStaging(),
    s = secrets();
  const get = async (path) => {
    const r = await fetch(c.app_url + path);
    if (!r.ok) throw new Error("Staging asset unavailable: " + path);
    return r;
  };
  const html = await (await get("/")).text();
  if (!html.includes("Mendocean Test"))
    throw new Error("Staging frontend label missing.");
  const manifest = await (await get("/manifest.webmanifest")).json();
  if (manifest.name !== "Mendocean Test")
    throw new Error("Staging Home Screen identity missing.");
  const worker = await (await get("/sw.js")).text();
  const release = JSON.parse(
    worker.match(/^const RELEASE = (.+);$/m)?.[1] || "null",
  );
  if (!release?.assets?.length)
    throw new Error("Staging service worker release missing.");
  for (const a of release.assets) {
    const digest = createHash("sha256")
      .update(Buffer.from(await (await get(a.url)).arrayBuffer()))
      .digest("hex");
    if (digest !== a.hash)
      throw new Error("Staging offline integrity failed: " + a.url);
  }
  const auth = await (
    await fetch(c.supabase_url + "/auth/v1/settings", {
      headers: { apikey: s.STAGING_SUPABASE_ANON_KEY },
    })
  ).json();
  if (!auth.disable_signup || !auth.external.email)
    throw new Error("Staging sign-in configuration invalid.");
  for (const path of [
    "/functions/v1/api/account",
    "/functions/v1/staging-test",
  ]) {
    const r = await fetch(c.supabase_url + path, {
      method: path.endsWith("staging-test") ? "POST" : "GET",
      headers: {
        apikey: s.STAGING_SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: path.endsWith("staging-test") ? '{"action":"publish"}' : undefined,
    });
    if (![401, 403].includes(r.status))
      throw new Error("Anonymous staging access was not denied.");
  }
  console.log(
    JSON.stringify({
      staging: true,
      precache_assets: release.assets.length,
      build: release.id,
      closed_signup: true,
      anonymous_denied: true,
    }),
  );
  return { c, s, release };
}
export async function smoke() {
  const { c, s, release } = await assets();
  const { client, session } = await testSession();
  try {
    const account = async () => {
      const r = await fetch(c.supabase_url + "/functions/v1/api/account", {
        headers: {
          apikey: s.STAGING_SUPABASE_ANON_KEY,
          Authorization: "Bearer " + session.access_token,
        },
      });
      if (!r.ok) throw new Error("Staging account unavailable.");
      return r.json();
    };
    const profile = (await account()).profile;
    if (profile.lineup_channels?.length)
      throw new Error(
        "Smoke requires notification preferences off to avoid sending.",
      );
    await trigger("reset");
    if ((await account()).lineups.length)
      throw new Error("Unpublished test lineup visible.");
    await trigger("publish");
    let lineups = (await account()).lineups;
    if (
      lineups.length !== 1 ||
      lineups[0].boats[0].seats.find((x) => x.athlete_id === 900000002)
        ?.seat !== "3"
    )
      throw new Error("Published own seat missing.");
    await trigger("seat");
    lineups = (await account()).lineups;
    if (
      lineups[0].boats[0].seats.find((x) => x.athlete_id === 900000002)
        ?.seat !== "2"
    )
      throw new Error("Seat move missing.");
    await trigger("remove");
    lineups = (await account()).lineups;
    if (lineups[0].boats[0].seats.some((x) => x.athlete_id === 900000002))
      throw new Error("Removal missing.");
    await trigger("reset");
    await trigger("publish");
    console.log(
      JSON.stringify({
        staging_smoke: "passed",
        precache_assets: release.assets.length,
        build: release.id,
        notifications_sent: 0,
      }),
    );
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}
export async function emailCheck() {
  const c = await assertStaging(),
    s = secrets();
  const [profile] = await query(
    `select lineup_channels,lineup_changes from public.profiles where id='${s.STAGING_OWNER_ID}'`,
    true,
  );
  if (profile.lineup_channels.length)
    throw new Error("Email preflight requires notification preferences off.");
  try {
    await query(
      `update public.profiles set lineup_channels=array['email'] where id='${s.STAGING_OWNER_ID}'`,
    );
    await trigger("reset");
    await trigger("publish");
    console.log(
      "One full-lineup test email queued for the approved staging owner. Waiting for real provider acceptance.",
    );
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const rows = await query(
        `select d.sent_at,d.error from private.lineup_deliveries d join private.lineup_events e on e.id=d.event_id where e.user_id='${s.STAGING_OWNER_ID}' and d.channel='email' order by e.created_at desc limit 1`,
        true,
      );
      if (rows[0]?.sent_at) {
        console.log(
          "Full-lineup test email accepted by provider. Inbox receipt remains for the owner to confirm.",
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
    throw new Error(
      "Email provider acceptance was not confirmed within two minutes.",
    );
  } finally {
    await query(
      `update public.profiles set lineup_channels='{}',lineup_changes='${profile.lineup_changes}' where id='${s.STAGING_OWNER_ID}'`,
    );
  }
}
