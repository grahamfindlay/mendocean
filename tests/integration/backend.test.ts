import { beforeAll, beforeEach, afterAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { report } from "../fixtures";
import {
  api,
  anon,
  db,
  sql,
  user,
  url,
  publicClient,
  fixtures,
  tick,
  resetJobs,
  createOuting,
  cleanupUsers,
  enqueue,
  practice,
  syntheticToken,
  secret,
  type Actor,
} from "../support/stack";
let a: Actor, b: Actor, unapproved: Actor;
beforeAll(async () => {
  a = await user();
  b = await user();
  unapproved = await user(false);
  await resetJobs();
  await tick();
});
beforeEach(resetJobs);
afterAll(async () => {
  await cleanupUsers([a, b, unapproved]);
  await sql.end();
});
const row = (
  o: ReturnType<typeof import("../support/stack").outing>,
  changes = {},
) => report({ actual_start: o.starts_at, actual_end: o.ends_at, ...changes });
test("real Auth invitations and unsigned access boundaries", async () => {
  expect((await api(null, "account")).status).toBe(401);
  expect((await api({ ...a, token: "invalid" }, "account")).status).toBe(401);
  expect((await api(unapproved, "account")).status).toBe(403);
  expect(
    (
      await publicClient().auth.signUp({
        email: `signup-${randomUUID()}@example.test`,
        password: "NoSignup123!",
      })
    ).error,
  ).toBeTruthy();
  for (const path of ["account", "export", "health"])
    expect((await api(null, path)).status).toBe(401);
  expect((await api(b, "health")).status).toBe(403);
  const r = await fetch(url + "/functions/v1/jobs", {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: '{"action":"tick"}',
  });
  expect(r.status).toBe(401);
});
test("reports persist, retry once, conflict safely, remain private, and delete", async () => {
  const o = await createOuting(a);
  const payload = { outing: o, report: row(o) };
  const saved = await api(a, "report", payload);
  expect(saved.status).toBe(200);
  expect((await api(a, "report", payload)).data).toEqual(saved.data);
  expect(
    (await sql.query("select * from reports where outing_id=$1", [o.id]))
      .rowCount,
  ).toBe(1);
  for (const path of ["account", "export"])
    expect(JSON.stringify((await api(b, path)).data)).not.toContain(o.id);
  expect(
    (await b.client.from("reports").select("*").eq("outing_id", o.id)).data,
  ).toEqual([]);
  expect(
    (await b.client.rpc("save_report", { target: o.id, body: row(o) })).error,
  ).toBeTruthy();
  expect(
    (await api(b, "report", { outing: o, report: row(o) })).status,
  ).not.toBe(200);
  expect(
    (await api(b, "report/delete", { id: saved.data.id, version: 1 })).status,
  ).not.toBe(200);
  expect(
    (await b.client.rpc("service_query", { action: "connections", args: {} }))
      .error,
  ).toBeTruthy();
  expect(
    (
      await b.client
        .from("reports")
        .update({ data: row(o) })
        .eq("id", saved.data.id)
        .select()
    ).error,
  ).toBeTruthy();
  expect(
    (await b.client.from("reports").delete().eq("id", saved.data.id).select())
      .error,
  ).toBeTruthy();
  const edits = await Promise.all([
    api(a, "report", {
      outing: o,
      report: row(o, { expected_version: 1, rating: 3 }),
    }),
    api(a, "report", {
      outing: o,
      report: row(o, { expected_version: 1, rating: 4 }),
    }),
  ]);
  expect(edits.map((x) => x.status).sort()).toEqual([200, 409]);
  expect(
    (await api(a, "report/delete", { id: saved.data.id, version: 1 })).status,
  ).toBe(409);
  expect(
    (await api(a, "report/delete", { id: saved.data.id, version: 2 })).status,
  ).toBe(200);
  expect(
    (await sql.query("select * from reports where outing_id=$1", [o.id]))
      .rowCount,
  ).toBe(0);
});
test.each(["wind_waves", "non_weather"])(
  "cancellation %s survives API validation and storage",
  async (reason) => {
    const o = await createOuting(a);
    const r = row(o, {
      outcome: "stayed_ashore",
      rating: null,
      reason,
      boat_class: null,
      route: "unknown",
    });
    expect((await api(a, "report", { outing: o, report: r })).status).toBe(200);
    const saved = (
      await sql.query("select data from reports where outing_id=$1", [o.id])
    ).rows[0].data;
    expect(saved.reason).toBe(reason);
    expect(saved.rating).toBeNull();
    expect(
      (await api(a, "report", { outing: o, report: { ...r, rating: 4 } }))
        .status,
    ).toBe(400);
  },
);
test("BHC connects, imports attendance/lineups, deduplicates shared practices, and preserves reports", async () => {
  const base = 10000 + Math.floor(Math.random() * 100000);
  const practices = [
    practice(base),
    practice(base + 1, "declined"),
    practice(base + 2, "unknown"),
  ];
  await fixtures({ bhc: practices });
  for (const actor of [a, b])
    expect(
      (await api(actor, "bhc/connect", { token: syntheticToken })).status,
    ).toBe(200);
  await tick();
  let rows = (
    await sql.query(
      "select * from outings where bhc_practice_id between $1 and $2",
      [base, base + 2],
    )
  ).rows;
  expect(rows).toHaveLength(3);
  const o = rows.find((r) => Number(r.bhc_practice_id) === base);
  expect(
    (await sql.query("select * from outing_members where outing_id=$1", [o.id]))
      .rowCount,
  ).toBe(2);
  expect(
    (
      await sql.query(
        "select attendance from outing_members where user_id=$1 and outing_id=any($2::uuid[]) order by attendance",
        [a.id, rows.map((r) => r.id)],
      )
    ).rows.map((r) => r.attendance),
  ).toEqual(["attending", "declined", "unknown"]);
  for (const actor of [a, b])
    expect(
      (await api(actor, "report", { outing: o, report: row(o) })).status,
    ).toBe(200);
  const before = (
    await sql.query(
      "select data from reports where outing_id=$1 order by user_id",
      [o.id],
    )
  ).rows;
  await enqueue("enrich", null, o.id);
  await tick();
  const snapshot = await db.rpc("service_query", {
    action: "training_snapshot",
    args: {},
  });
  expect(snapshot.error).toBeNull();
  const grouped = snapshot.data.rows.filter((r: any) => r.outing_id === o.id);
  expect(grouped).toHaveLength(2);
  expect(new Set(grouped.map((r: any) => r.user_id))).toEqual(
    new Set([a.id, b.id]),
  );
  expect(
    grouped.every(
      (r: any) => !("notes" in r.report) && !("submission_id" in r.report),
    ),
  ).toBe(true);
  await fixtures({
    lineup: true,
    bhc: practices.map((p) => ({
      ...p,
      start_time: p.start_time + 60,
      end_time: p.end_time + 60,
    })),
  });
  await enqueue("bhc_sync", a.id);
  await tick();
  expect(
    (
      await sql.query(
        "select planned_boat,planned_seat from outing_members where user_id=$1 and outing_id=$2",
        [a.id, o.id],
      )
    ).rows[0],
  ).toEqual({ planned_boat: "2x", planned_seat: "2" });
  expect(
    (
      await sql.query(
        "select data from reports where outing_id=$1 order by user_id",
        [o.id],
      )
    ).rows,
  ).toEqual(before);
  expect(
    (await sql.query("select * from outings where bhc_practice_id=$1", [base]))
      .rowCount,
  ).toBe(1);
  await api(a, "bhc/disconnect", {});
  expect((await api(a, "account")).data.bhc.connected).toBe(false);
  expect((await api(a, "bhc/connect", { token: syntheticToken })).status).toBe(
    200,
  );
  await tick();
  expect(
    (await sql.query("select * from outings where bhc_practice_id=$1", [base]))
      .rowCount,
  ).toBe(1);
  await api(a, "bhc/disconnect", {});
  await api(b, "bhc/disconnect", {});
});
test("BHC malformed/invalid response is safe; failed sync unlocks and can recover", async () => {
  expect(
    (await api(a, "bhc/connect", { token: "invalid-bhc-token-xxxxxxxx" }))
      .status,
  ).toBe(502);
  await api(a, "bhc/connect", { token: syntheticToken });
  await fixtures({ failure: "malformed" });
  await tick();
  let c = (await api(a, "account")).data.bhc;
  expect(c.last_error).toContain("Practice import failed");
  expect(JSON.stringify(c)).not.toContain(syntheticToken);
  await fixtures({ failure: null });
  await sql.query(
    "update private.jobs set due_at=now()-interval '1 second' where status='pending'",
  );
  await tick();
  expect((await api(a, "account")).data.bhc.last_error).toBeNull();
  await api(a, "bhc/disconnect", {});
});
test("BHC continuation imports more than twelve practices without duplication", async () => {
  const base = 200000;
  await fixtures({
    bhc: Array.from({ length: 15 }, (_, i) => practice(base + i)),
  });
  await api(a, "bhc/connect", { token: syntheticToken });
  await expect
    .poll(
      async () => {
        await tick();
        return (
          await sql.query(
            "select * from outings where bhc_practice_id between $1 and $2",
            [base, base + 14],
          )
        ).rowCount;
      },
      { timeout: 15000, interval: 100 },
    )
    .toBe(15);
  await api(a, "bhc/disconnect", {});
});
async function reminder(actor: Actor, channel = "email") {
  await api(actor, "settings", {
    display_name: "Synthetic",
    reminder_channel: channel,
    reminders_paused: false,
  });
  return createOuting(actor, { reminder: true });
}
test.each([
  "declined",
  "unknown",
  "paused",
  "skipped",
  "reported",
  "early",
  "expired",
])("reminder suppressed for %s", async (condition) => {
  const o = await reminder(a);
  if (["declined", "unknown"].includes(condition))
    await sql.query(
      "update outing_members set attendance=$1 where outing_id=$2",
      [condition, o.id],
    );
  if (condition === "paused")
    await sql.query("update profiles set reminders_paused=true where id=$1", [
      a.id,
    ]);
  if (condition === "skipped")
    await api(a, "reminder", { outing_id: o.id, action: "skip" });
  if (condition === "reported")
    await api(a, "report", { outing: o, report: row(o) });
  if (condition === "early")
    await sql.query(
      "update outings set starts_at=now()-interval '1 hour',ends_at=now()-interval '5 minutes' where id=$1",
      [o.id],
    );
  if (condition === "expired")
    await sql.query(
      "update outings set starts_at=now()-interval '27 hours',ends_at=now()-interval '26 hours' where id=$1",
      [o.id],
    );
  await tick();
  expect((await fixtures()).deliveries).toHaveLength(0);
});
test("chosen channel, repeated dispatcher, email ambiguity and snooze generation", async () => {
  const o = await reminder(a);
  await fixtures({ failure: "after_accept" });
  await tick();
  expect((await fixtures()).deliveries).toHaveLength(1);
  await sql.query(
    "update private.jobs set due_at=now()-interval '1 second' where status='pending' and kind='reminder'",
  );
  await tick();
  await tick();
  let state = await fixtures();
  expect(state.deliveries).toHaveLength(1);
  expect(state.attempts.length).toBe(2);
  expect(state.deliveries[0].channel).toBe("email");
  await api(a, "reminder", { outing_id: o.id, action: "snooze" });
  await tick();
  expect((await fixtures()).deliveries).toHaveLength(1);
  await sql.query(
    "update private.jobs set due_at=now()-interval '1 second' where status='pending' and kind='reminder'",
  );
  await tick();
  expect((await fixtures()).deliveries).toHaveLength(2);
});
test("concurrent ticks claim each job once and retry failures with bounded backoff", async () => {
  await reminder(a);
  await fixtures({ failure: "delivery" });
  await Promise.all([tick(), tick()]);
  expect((await fixtures()).attempts).toHaveLength(1);
  const job = (
    await sql.query(
      "select *,extract(epoch from due_at-now()) delay from private.jobs where kind='reminder'",
    )
  ).rows[0];
  expect(job.status).toBe("pending");
  expect(Number(job.delay)).toBeGreaterThan(90);
  await fixtures({ failure: null });
  await sql.query(
    "update private.jobs set due_at=now()-interval '1 second' where kind='reminder'",
  );
  await tick();
  expect((await fixtures()).deliveries).toHaveLength(1);
});
test("push test targets only the current user registration and cleans expired endpoints", async () => {
  const endpoint = "https://web.push.apple.com/" + randomUUID();
  const subscription = {
    endpoint,
    keys: { auth: "synthetic", p256dh: "synthetic" },
  };
  expect(
    (
      await api(a, "push", {
        subscription: { ...subscription, endpoint: "http://127.0.0.1/private" },
      })
    ).status,
  ).toBe(400);
  expect((await api(a, "push", { subscription })).status).toBe(200);
  expect((await api(b, "push/test", { endpoint })).status).toBe(400);
  expect((await api(a, "push/test", { endpoint })).status).toBe(200);
  expect((await fixtures()).deliveries[0].payload.title).toBe(
    "Mendocean test notification",
  );
  await fixtures({ failure: "expired", deliveries: [] });
  expect((await api(a, "push/test", { endpoint })).status).toBe(400);
  expect(
    (
      await sql.query(
        "select * from private.push_subscriptions where endpoint=$1",
        [endpoint],
      )
    ).rowCount,
  ).toBe(0);
  await reminder(a, "push");
  await tick();
  expect((await fixtures()).deliveries).toHaveLength(0);
});
test("weather archives are private, immutable gzip and enrich from the archived run", async () => {
  await sql.query(
    "update weather_runs set fetched_at=now()-interval '2 hours'",
  );
  await tick();
  const run = (
    await sql.query(
      "select * from weather_runs order by fetched_at desc limit 1",
    )
  ).rows[0];
  const download = await db.storage
    .from("weather-archive")
    .download(run.object_path);
  expect(download.error).toBeNull();
  const forecast = JSON.parse(
    gunzipSync(Buffer.from(await download.data!.arrayBuffer())).toString(),
  );
  expect(forecast.hours.length).toBeGreaterThan(120);
  expect(
    (
      await publicClient()
        .storage.from("weather-archive")
        .download(run.object_path)
    ).error,
  ).toBeTruthy();
  expect(
    (
      await db.storage
        .from("weather-archive")
        .upload(run.object_path, new Uint8Array([0]), {
          contentType: "application/gzip",
          upsert: false,
        })
    ).error,
  ).toBeTruthy();
  const o = await createOuting(a);
  await sql.query("update weather_runs set fetched_at=$1 where id=$2", [
    new Date(Date.parse(o.starts_at) - 60000).toISOString(),
    run.id,
  ]);
  await enqueue("enrich", null, o.id);
  await tick();
  expect(
    (
      await sql.query(
        "select source_kind from private.weather_features where outing_id=$1",
        [o.id],
      )
    ).rows[0].source_kind,
  ).toBe("archived_forecast");
});
test("weather failures retain cache; stale assessment is rejected; historical enrichment works", async () => {
  await sql.query(
    "update weather_runs set fetched_at=now()-interval '11 hours'",
  );
  await fixtures({ failure: "weather" });
  await tick();
  expect((await api(null, "weather")).status).toBe(200);
  expect(
    (
      await api(null, "assessment", {
        time: new Date().toISOString(),
        basis: "pooled",
        route: "either",
        boat: "",
        coach: "",
      })
    ).status,
  ).toBe(503);
  await fixtures({ failure: null });
  const o = await createOuting(a);
  await enqueue("enrich", null, o.id);
  await tick();
  expect(
    (
      await sql.query(
        "select source_kind from private.weather_features where outing_id=$1",
        [o.id],
      )
    ).rows[0].source_kind,
  ).toBe("historical_forecast");
  await sql.query(
    "update private.jobs set due_at=now()-interval '1 second' where status='pending'",
  );
  await tick();
});

test("malformed weather cannot replace the cached forecast", async () => {
  await sql.query(
    "update weather_runs set fetched_at=now()-interval '30 minutes'",
  );
  const before = (await api(null, "weather")).data;
  await fixtures({ failure: "weather_malformed" });
  await tick();
  expect((await api(null, "weather")).data).toEqual(before);
  expect(
    (
      await sql.query(
        "select status from private.jobs where kind='weather' order by id desc limit 1",
      )
    ).rows[0].status,
  ).toBe("pending");
});

test("dispatcher releases its claims when the elapsed-time budget is exhausted", async () => {
  await enqueue("weather", null, null);
  const response = await fetch(url + "/functions/v1/jobs-budget", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "tick" }),
  });
  expect(response.status).toBe(200);
  const jobs = (await sql.query("select status from private.jobs")).rows;
  expect(jobs.length).toBeGreaterThan(0);
  expect(jobs.every((j) => j.status === "pending")).toBe(true);
  await tick();
  expect(
    (await sql.query("select id from private.jobs where status <> 'done'"))
      .rowCount,
  ).toBe(0);
});

test("queue expires old work, releases unused claims, and exhausts retries", async () => {
  await enqueue("unknown-task");
  await sql.query(
    "update private.jobs set expires_at=now()-interval '1 second'",
  );
  await tick();
  expect(
    (
      await sql.query(
        "select status from private.jobs where kind='unknown-task'",
      )
    ).rows[0].status,
  ).toBe("cancelled");
  await enqueue("unknown-task");
  const claimed = await db.rpc("service_query", { action: "claim", args: {} });
  expect(claimed.error).toBeNull();
  const ids = claimed.data.map((j: any) => j.id);
  expect((await db.rpc("release_claims", { ids })).error).toBeNull();
  expect(
    (
      await sql.query("select attempts,status from private.jobs where id=$1", [
        ids[0],
      ])
    ).rows[0],
  ).toEqual({ attempts: 0, status: "pending" });
  await sql.query("update private.jobs set attempts=4 where status='pending'");
  await tick();
  const failed = (
    await sql.query("select status,last_error from private.jobs where id=$1", [
      ids[0],
    ])
  ).rows[0];
  expect(failed.status).toBe("failed");
  expect(failed.last_error).toContain("no credentials");
});

test("rescheduled reminder suppresses the old job and honors the new end time", async () => {
  const o = await reminder(a);
  await sql.query(
    "update outings set starts_at=now()-interval '1 hour',ends_at=now()+interval '1 hour' where id=$1",
    [o.id],
  );
  await tick();
  expect((await fixtures()).deliveries).toHaveLength(0);
  await sql.query(
    "update outings set ends_at=now()-interval '16 minutes' where id=$1",
    [o.id],
  );
  await api(a, "reminder", { outing_id: o.id, action: "enable" });
  await tick();
  expect((await fixtures()).deliveries).toHaveLength(1);
});
