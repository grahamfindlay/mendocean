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
beforeEach(async () => {
  await resetJobs();
  // Settings changes intentionally restore unfinished reminders; isolate earlier fixtures.
  await sql.query(
    "update outing_members set reminder=false where user_id=any($1::uuid[])",
    [[a.id, b.id, unapproved.id]],
  );
  await sql.query(
    "delete from private.push_subscriptions where user_id=any($1::uuid[])",
    [[a.id, b.id, unapproved.id]],
  );
});
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
    "update outings set title='Changed after provider acceptance' where id=$1",
    [o.id],
  );
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
  expect(forecast.quarter_hours).toHaveLength(196);
  expect(forecast.quarter_hours[0].interval_minutes).toBe(15);
  expect(forecast.quarter_hours[0].probability).toBeNull();
  expect((await api(null, "weather")).data.quarter_hours).toEqual(
    forecast.quarter_hours,
  );
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

test("reminder presentation is private and rejects scheduling that cannot be delivered", async () => {
  const o = await reminder(a);
  const state = () =>
    api(a, "account").then(
      (r) => r.data.outings.find((v: any) => v.id === o.id).reminder_state,
    );
  expect((await state()).due_at).toBeTruthy();
  expect((await state()).sent_at).toBeNull();
  expect(
    (await b.client.rpc("reminder_states", { uid: a.id })).error,
  ).toBeTruthy();
  expect(
    (await publicClient().rpc("reminder_states", { uid: a.id })).error,
  ).toBeTruthy();
  expect(JSON.stringify((await api(b, "account")).data)).not.toContain(o.id);
  await tick();
  expect((await state()).sent_at).toBeTruthy();
  expect((await state()).due_at).toBeNull();
  expect(
    (await api(a, "reminder", { outing_id: o.id, action: "enable" })).status,
  ).toBe(409);
  expect(
    (await api(a, "reminder", { outing_id: o.id, action: "snooze" })).status,
  ).toBe(200);
  expect((await state()).due_at).toBeTruthy();
  expect((await state()).sent_at).toBeNull();
  await api(a, "report", { outing: o, report: row(o) });
  expect(
    (await api(a, "reminder", { outing_id: o.id, action: "snooze" })).status,
  ).toBe(409);
  const another = await reminder(a);
  await sql.query(
    "update outings set starts_at=now()-interval '25 hours', ends_at=now()-interval '23 hours 30 minutes' where id=$1",
    [another.id],
  );
  expect(
    (await api(a, "reminder", { outing_id: another.id, action: "snooze" }))
      .status,
  ).toBe(409);
  await sql.query(
    "update outing_members set attendance='declined' where outing_id=$1",
    [another.id],
  );
  expect(
    (await api(a, "reminder", { outing_id: another.id, action: "enable" }))
      .status,
  ).toBe(409);
});

test("push registration status is scoped to the authenticated account", async () => {
  const endpoint = "https://web.push.apple.com/" + randomUUID();
  await api(a, "push", {
    subscription: {
      endpoint,
      keys: { auth: "synthetic", p256dh: "synthetic" },
    },
  });
  expect((await api(a, "push/status", { endpoint })).data).toEqual({
    registered: true,
  });
  expect((await api(b, "push/status", { endpoint })).data).toEqual({
    registered: false,
  });
  expect((await api(null, "push/status", { endpoint })).status).toBe(401);
});

test("model capabilities stay public without exposing personal data or coefficients", async () => {
  const result = await api(null, "assessment/capabilities");
  expect(result.status).toBe(200);
  expect(result.data).toEqual({ pooled: [], mine: [] });
});

test("weather collector refreshes after a quarter hour and shares its recent cache", async () => {
  await sql.query(
    "update weather_runs set fetched_at=now()-interval '16 minutes'",
  );
  const before = (await api(null, "weather")).data.fetched_at;
  await tick();
  const fresh = (await api(null, "weather")).data;
  expect(fresh.fetched_at).not.toBe(before);
  expect(fresh.quarter_hours.length).toBeGreaterThan(8);
  await enqueue("weather", null, null);
  await tick();
  expect((await api(null, "weather")).data.fetched_at).toBe(fresh.fetched_at);
});

async function channels(actor: Actor, selected: string[], paused = false) {
  const r = await api(actor, "settings", {
    display_name: "Synthetic",
    reminder_channels: selected,
    reminders_paused: paused,
  });
  expect(r.status).toBe(200);
}
async function device(actor: Actor) {
  const endpoint = "https://web.push.apple.com/" + randomUUID();
  expect(
    (
      await api(actor, "push", {
        subscription: {
          endpoint,
          keys: { auth: "synthetic", p256dh: "synthetic" },
        },
      })
    ).status,
  ).toBe(200);
  return endpoint;
}
async function retryReminders() {
  await sql.query(
    "update private.jobs set due_at=now()-interval '1 second' where status='pending' and kind='reminder'",
  );
  await tick();
}
test.each(["email", "push"])(
  "both channels: failed %s retries without repeating the successful channel",
  async (failed) => {
    await channels(a, ["email", "push"]);
    await device(a);
    const o = await createOuting(a, { reminder: true });
    await fixtures({ failure: failed + "_failure" });
    await tick();
    expect((await fixtures()).deliveries).toHaveLength(1);
    const state = (await api(a, "account")).data.outings.find(
      (v: any) => v.id === o.id,
    ).reminder_state;
    expect(state.sent_at).toBeNull();
    expect(state.channels.find((c: any) => c.channel === failed).status).toBe(
      "retrying",
    );
    expect(state.channels.find((c: any) => c.channel !== failed).status).toBe(
      "sent",
    );
    expect(JSON.stringify(state)).not.toContain("endpoint");
    await fixtures({ failure: null });
    await retryReminders();
    await tick();
    const sent = (await fixtures()).deliveries;
    expect(sent.filter((d: any) => d.channel === "email")).toHaveLength(1);
    expect(sent.filter((d: any) => d.channel === "push")).toHaveLength(1);
    expect(
      (
        await sql.query(
          "select * from private.delivery_budget where user_id=$1 and outing_id=$2",
          [a.id, o.id],
        )
      ).rowCount,
    ).toBe(2);
    // Explicit snooze starts a new generation and intentionally sends both again.
    await api(a, "reminder", { outing_id: o.id, action: "snooze" });
    await retryReminders();
    expect((await fixtures()).deliveries).toHaveLength(4);
    await sql.query("delete from private.push_subscriptions where user_id=$1", [
      a.id,
    ]);
  },
);
test("push checkpoints successful devices and retries only the remaining endpoint", async () => {
  await channels(a, ["push"]);
  const first = await device(a),
    second = await device(a);
  const o = await createOuting(a, { reminder: true });
  await fixtures({ failed_targets: [second] });
  await tick();
  expect((await fixtures()).deliveries.map((d: any) => d.target)).toEqual([
    first,
  ]);
  const state = (await api(a, "account")).data.outings.find(
    (v: any) => v.id === o.id,
  ).reminder_state;
  expect(state.channels[0]).toMatchObject({
    channel: "push",
    status: "retrying",
    devices_sent: 1,
  });
  await fixtures({ failed_targets: [] });
  await retryReminders();
  expect(
    (await fixtures()).deliveries.map((d: any) => d.target).sort(),
  ).toEqual([first, second].sort());
  await sql.query("delete from private.push_subscriptions where user_id=$1", [
    a.id,
  ]);
});
test("no push device cannot prevent selected email, and registration retries only unfinished push", async () => {
  await channels(a, ["email", "push"]);
  const o = await createOuting(a, { reminder: true });
  await tick();
  expect((await fixtures()).deliveries.map((d: any) => d.channel)).toEqual([
    "email",
  ]);
  const state = (await api(a, "account")).data.outings.find(
    (v: any) => v.id === o.id,
  ).reminder_state;
  expect(state.channels.find((c: any) => c.channel === "push").error).toBe(
    "no_device",
  );
  await device(a);
  await retryReminders();
  expect((await fixtures()).deliveries.map((d: any) => d.channel)).toEqual([
    "email",
    "push",
  ]);
  await sql.query("delete from private.push_subscriptions where user_id=$1", [
    a.id,
  ]);
});
test("neither channel, legacy preference mapping, and changed pending preferences", async () => {
  await channels(a, []);
  const o = await createOuting(a, { reminder: true });
  await tick();
  expect((await fixtures()).deliveries).toHaveLength(0);
  expect((await api(a, "account")).data.profile.reminder_channel).toBe("none");
  // Enabling a channel restores an unfinished reminder without changing per-outing opt-in.
  await channels(a, ["email", "push"]);
  await fixtures({ failure: "delivery" });
  await tick();
  await channels(a, ["email"]);
  await fixtures({ failure: null });
  await retryReminders();
  expect((await fixtures()).deliveries.map((d: any) => d.channel)).toEqual([
    "email",
  ]);
  // Completed reminders stay completed when another channel is selected later.
  await device(a);
  await channels(a, ["email", "push"]);
  await tick();
  expect((await fixtures()).deliveries).toHaveLength(1);
  await api(a, "settings", {
    display_name: "Synthetic",
    reminder_channel: "push",
    reminders_paused: false,
  });
  expect((await api(a, "account")).data.profile.reminder_channels).toEqual([
    "push",
  ]);
  await sql.query("delete from private.push_subscriptions where user_id=$1", [
    a.id,
  ]);
});
test("a report submitted after partial delivery suppresses the pending channel", async () => {
  await channels(a, ["email", "push"]);
  await device(a);
  const o = await createOuting(a, { reminder: true });
  await fixtures({ failure: "push_failure" });
  await tick();
  await api(a, "report", { outing: o, report: row(o) });
  await fixtures({ failure: null });
  await retryReminders();
  expect((await fixtures()).deliveries.map((d: any) => d.channel)).toEqual([
    "email",
  ]);
  await sql.query("delete from private.push_subscriptions where user_id=$1", [
    a.id,
  ]);
});
test("channel leases fence duplicate jobs, stale tokens and snooze generations", async () => {
  await channels(a, ["email", "push"]);
  await device(a);
  const o = await createOuting(a, { reminder: true });
  const args = { uid: a.id, outing: o.id, gen: 0, target_channel: "email" };
  const [one, two] = await Promise.all([
    db.rpc("reserve_reminder_channel", args),
    db.rpc("reserve_reminder_channel", args),
  ]);
  expect([one.data.allowed, two.data.allowed].filter(Boolean)).toHaveLength(1);
  const allowed = one.data.allowed ? one.data : two.data;
  expect(
    (await b.client.rpc("reserve_reminder_channel", args)).error,
  ).toBeTruthy();
  await db.rpc("finish_reminder_channel", {
    ...args,
    token: randomUUID(),
    failure: null,
  });
  expect((await db.rpc("reserve_reminder_channel", args)).data.busy).toBe(true);
  await api(a, "reminder", { outing_id: o.id, action: "snooze" });
  expect(
    (await db.rpc("reminder_channel_active", { ...args, token: allowed.token }))
      .data,
  ).toBe(false);
  await db.rpc("finish_reminder_channel", {
    ...args,
    token: allowed.token,
    failure: null,
  });
  await retryReminders();
  expect((await fixtures()).deliveries).toHaveLength(2);
  // Two independently queued jobs still cannot repeat accepted channels.
  await enqueue("reminder", a.id, o.id, { generation: 1 });
  await Promise.all([tick(), tick()]);
  expect((await fixtures()).deliveries).toHaveLength(2);
  await sql.query("delete from private.push_subscriptions where user_id=$1", [
    a.id,
  ]);
});
test("email quota does not block push and successful push is not repeated after quota clears", async () => {
  await channels(a, ["email", "push"]);
  await device(a);
  const o = await createOuting(a, { reminder: true });
  await sql.query(
    "insert into private.delivery_budget(user_id,outing_id,generation,channel) select $1,$2,n,'email' from generate_series(100,179) n",
    [b.id, o.id],
  );
  try {
    await tick();
    expect((await fixtures()).deliveries.map((d: any) => d.channel)).toEqual([
      "push",
    ]);
    await sql.query(
      "delete from private.delivery_budget where user_id=$1 and outing_id=$2",
      [b.id, o.id],
    );
    await retryReminders();
    expect((await fixtures()).deliveries.map((d: any) => d.channel)).toEqual([
      "push",
      "email",
    ]);
  } finally {
    await sql.query(
      "delete from private.delivery_budget where user_id=$1 and outing_id=$2",
      [b.id, o.id],
    );
    await sql.query("delete from private.push_subscriptions where user_id=$1", [
      a.id,
    ]);
  }
});

async function editablePractice() {
  const id = 900000 + Math.floor(Math.random() * 100000);
  const p = {
    ...practice(id, "unknown"),
    start_time: Math.floor(Date.now() / 1000) + 86400,
    end_time: Math.floor(Date.now() / 1000) + 90000,
    attendance_window_start: Math.floor(Date.now() / 1000) - 3600,
    attendance_window_end: Math.floor(Date.now() / 1000) + 3600,
    set_attendance_allowed: true,
  };
  await fixtures({ bhc: [p] });
  await api(a, "bhc/connect", { token: syntheticToken });
  await tick();
  const o = (
    await sql.query("select * from outings where bhc_practice_id=$1", [id])
  ).rows[0];
  return { p, o };
}
const attendanceChange = (
  o: any,
  attendance = "attending",
  expected = "unknown",
  request_id = randomUUID(),
) => ({ outing_id: o.id, change: { attendance, expected, request_id } });
const attendanceWrites = async () =>
  (await fixtures()).calls.filter(
    (c: any) => c.path === "/practices/setAttendance",
  );
test("BHC attendance writes only own eligible practice, confirms readback and adjusts reminders", async () => {
  const { o } = await editablePractice();
  const state = await api(a, "bhc/attendance", { outing_id: o.id });
  expect(state.data.state).toMatchObject({
    allowed: true,
    attendance: "unknown",
  });
  expect((await api(null, "bhc/attendance", attendanceChange(o))).status).toBe(
    401,
  );
  expect((await api(b, "bhc/attendance", attendanceChange(o))).status).toBe(
    404,
  );
  expect(
    (await api(a, "bhc/attendance", { ...attendanceChange(o), custid: 999 }))
      .status,
  ).toBe(400);
  expect(
    (await api(a, "bhc/attendance", attendanceChange(o, "unknown"))).status,
  ).toBe(400);
  expect(
    (await api(a, "bhc/attendance", attendanceChange(await createOuting(a))))
      .status,
  ).toBe(400);
  expect(await attendanceWrites()).toHaveLength(0);
  await api(a, "settings", {
    display_name: "Fixture",
    reminder_channels: ["email"],
    reminders_paused: false,
  });
  const body = attendanceChange(o);
  expect((await api(a, "bhc/attendance", body)).data.outcome).toBe("confirmed");
  expect((await api(a, "bhc/attendance", body)).data.outcome).toBe("confirmed");
  expect(await attendanceWrites()).toHaveLength(1);
  expect(
    (
      await sql.query(
        "select attendance,reminder from outing_members where user_id=$1 and outing_id=$2",
        [a.id, o.id],
      )
    ).rows[0],
  ).toEqual({ attendance: "attending", reminder: true });
  expect(
    (
      await sql.query(
        "select * from private.jobs where user_id=$1 and outing_id=$2 and kind='reminder' and status='pending'",
        [a.id, o.id],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await api(
        a,
        "bhc/attendance",
        attendanceChange(o, "declined", "attending"),
      )
    ).data.outcome,
  ).toBe("confirmed");
  expect(
    (
      await sql.query(
        "select * from private.jobs where user_id=$1 and outing_id=$2 and kind='reminder' and status='pending'",
        [a.id, o.id],
      )
    ).rowCount,
  ).toBe(0);
  await sql.query(
    "update outing_members set skipped=true where user_id=$1 and outing_id=$2",
    [a.id, o.id],
  );
  expect(
    (
      await api(
        a,
        "bhc/attendance",
        attendanceChange(o, "attending", "declined"),
      )
    ).data.outcome,
  ).toBe("confirmed");
  expect(
    (
      await sql.query(
        "select reminder,skipped from outing_members where user_id=$1 and outing_id=$2",
        [a.id, o.id],
      )
    ).rows[0],
  ).toEqual({ reminder: false, skipped: true });
  await api(a, "bhc/disconnect", {});
  expect((await api(a, "bhc/attendance", attendanceChange(o))).status).toBe(
    409,
  );
});
test("BHC attendance rejects stale status, closed windows and provider restrictions without a write", async () => {
  const { o, p } = await editablePractice();
  for (const patch of [
    { attendance_window_end: Math.floor(Date.now() / 1000) },
    { attendance_window_start: Math.floor(Date.now() / 1000) + 600 },
    { set_attendance_allowed: false },
    { set_attendance_allowed: undefined },
  ]) {
    await fixtures({ bhc: [{ ...p, ...patch }] });
    expect(
      (await api(a, "bhc/attendance", attendanceChange(o))).data.outcome,
    ).toBe("blocked");
  }
  await fixtures({
    bhc: [{ ...p, current_attendance_status: "Not Attending" }],
  });
  expect(
    (await api(a, "bhc/attendance", attendanceChange(o))).data.outcome,
  ).toBe("conflict");
  await fixtures({ bhc: [] });
  expect((await api(a, "bhc/attendance", attendanceChange(o))).status).toBe(
    409,
  );
  expect(await attendanceWrites()).toHaveLength(0);
  await api(a, "bhc/disconnect", {});
});
test.each([
  "attendance_after_accept",
  "attendance_rejected",
  "attendance_closed",
  "attendance_noop",
  "attendance_unreadable",
])(
  "BHC attendance reconciles %s and never replays a write",
  async (failure) => {
    const { o } = await editablePractice();
    await fixtures({ failure });
    const body = attendanceChange(o);
    const result = await api(a, "bhc/attendance", body);
    expect(result.status).toBe(200);
    expect(result.data.outcome).toBe(
      failure === "attendance_after_accept" ? "confirmed" : "unconfirmed",
    );
    await fixtures({ failure: null });
    const again = await api(a, "bhc/attendance", body);
    expect(again.status).toBe(200);
    expect(await attendanceWrites()).toHaveLength(1);
    if (["attendance_after_accept", "attendance_unreadable"].includes(failure))
      expect(again.data.state.attendance).toBe("attending");
    else expect(again.data.state.attendance).toBe("unknown");
    await api(a, "bhc/disconnect", {});
  },
);
test("BHC sync lock serializes attendance writes and service RPCs reject ordinary users", async () => {
  const { o } = await editablePractice();
  await sql.query(
    "update private.bhc_connections set sync_locked_until=now()+interval '1 minute' where user_id=$1",
    [a.id],
  );
  expect((await api(a, "bhc/attendance", attendanceChange(o))).status).toBe(
    409,
  );
  expect(await attendanceWrites()).toHaveLength(0);
  await sql.query(
    "update private.bhc_connections set sync_locked_until=null where user_id=$1",
    [a.id],
  );
  const results = await Promise.all([
    api(a, "bhc/attendance", attendanceChange(o)),
    api(a, "bhc/attendance", attendanceChange(o)),
  ]);
  expect(results.some((r) => r.data.outcome === "confirmed")).toBe(true);
  expect(await attendanceWrites()).toHaveLength(1);
  expect(
    (
      await a.client.rpc("claim_bhc_attendance", {
        uid: a.id,
        request: randomUUID(),
        outing: o.id,
        choice: "attending",
      })
    ).error,
  ).toBeTruthy();
  expect(
    (
      await a.client.rpc("apply_bhc_attendance", {
        uid: a.id,
        outing: o.id,
        choice: "attending",
        deadline: null,
      })
    ).error,
  ).toBeTruthy();
  await api(a, "bhc/disconnect", {});
});

test("Week periods persist per account with validated authenticated writes", async () => {
  const initial = await api(a, "week-periods");
  expect(initial.status).toBe(200);
  expect(initial.data.periods.map((p: any) => p.label)).toEqual(["Early morning", "Evening"]);
  const periods = [{id: "mid", label: "Mid morning", start: "09:00", end: "11:00", enabled: true}];
  expect((await api(a, "week-periods", {periods})).status).toBe(200);
  expect((await api(a, "week-periods")).data.periods).toEqual(periods);
  expect((await api(b, "week-periods")).data.periods).toHaveLength(2);
  expect((await api(null, "week-periods", {periods})).status).toBe(401);
  expect((await api(unapproved, "week-periods", {periods})).status).toBe(403);
  expect((await api(a, "week-periods", {periods: [{...periods[0], end: "08:00"}]})).status).toBe(400);
  expect((await api(a, "week-periods", {periods, user_id: b.id})).status).toBe(400);
  expect((await api(a, "week-periods")).data.periods).toEqual(periods);
  expect((await api(a, "week-periods", {periods: []})).status).toBe(200);
  expect((await api(a, "week-periods")).data.periods).toEqual([]);
});
