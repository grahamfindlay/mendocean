import { beforeAll, afterAll, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { ALICE, OUTING, report } from "./fixtures";
let db: PGlite;
const q = async (action: string, args = {}) =>
  (
    await db.query<any>("select public.observation_query($1,$2) result", [
      action,
      args,
    ])
  ).rows[0].result;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.objects(bucket_id text,metadata jsonb);create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql") && !f.includes("_storage"))
    .sort())
    await db.exec(
      readFileSync(`supabase/migrations/${f}`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
});
afterAll(async () => db?.close());
test("observation evidence and RPC are inaccessible to members and anonymous users", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await expect(q("health")).rejects.toThrow("permission denied");
    await expect(
      db.query("select * from private.observation_summaries"),
    ).rejects.toThrow();
    await db.exec("reset role");
  }
});
const row = (count = 5, wind = 5) => ({
  source: "buoy",
  start: "2026-10-07T12:00:00Z",
  end: "2026-10-07T12:05:00Z",
  observed_at: "2026-10-07T12:04:00Z",
  sample_count: count,
  wind,
  received_at: "2026-10-07T12:15:00Z",
  raw_paths: ["raw"],
});
async function capture(slot: number, rows: any[], at = "2026-10-07T12:15:00Z") {
  const reservation = await q("reserve", { source: "buoy", slot, at });
  expect(reservation.acquired).toBe(true);
  await q("commit", {
    source: "buoy",
    slot,
    lease: reservation.lease,
    id: crypto.randomUUID(),
    at,
    object_path: crypto.randomUUID(),
    rows,
    latest_observed_at: "2026-10-07T12:04:00Z",
  });
}
test("leases prevent concurrent collections, completed slots deduplicate, and revisions preserve first availability", async () => {
  const r = await q("reserve", {
    source: "buoy",
    slot: 0,
    at: "2026-10-07T12:10Z",
  });
  expect(
    (await q("reserve", { source: "buoy", slot: 1, at: "2026-10-07T12:11Z" }))
      .acquired,
  ).toBe(false);
  await q("error", {
    source: "buoy",
    lease: r.lease,
    id: crypto.randomUUID(),
    at: "2026-10-07T12:12Z",
    error: "timeout",
  });
  await capture(1, [row()]);
  expect(
    (await q("reserve", { source: "buoy", slot: 1, at: "2026-10-07T12:16Z" }))
      .acquired,
  ).toBe(false);
  await capture(2, [row(1, 99)], "2026-10-07T12:30Z");
  let data = (
    await db.query<any>("select * from private.observation_summaries")
  ).rows[0];
  expect(data.data.wind).toBe(5);
  expect(data.revision).toBe(1);
  await capture(3, [row(5, 6)], "2026-10-07T12:45Z");
  data = (await db.query<any>("select * from private.observation_summaries"))
    .rows[0];
  expect(data.data.wind).toBe(6);
  expect(data.revision).toBe(2);
  expect(data.first_received_at.toISOString()).toBe("2026-10-07T12:15:00.000Z");
});
test("cold history is pruned only after committing its archive index", async () => {
  const candidate = await q("archive_candidate", { at: "2027-02-01T00:00Z" });
  expect(candidate.day).toBe("2026-10-07");
  expect(candidate.rows).toHaveLength(1);
  expect(
    (
      await q("window", {
        start: "2026-10-07T12:00Z",
        end: "2026-10-07T13:00Z",
      })
    ).rows,
  ).toHaveLength(1);
  await capture(4, [row(5, 7)], "2026-10-07T13:00Z");
  await expect(
    q("archive_commit", {
      day: candidate.day,
      object_path: "stale-bundle",
      rows: candidate.rows,
    }),
  ).rejects.toThrow("snapshot changed");
  const current = await q("archive_candidate", { at: "2027-02-01T00:00Z" });
  await q("archive_commit", {
    day: current.day,
    object_path: "bundle",
    rows: current.rows,
  });
  const window = await q("window", {
    start: "2026-10-07T12:00Z",
    end: "2026-10-07T13:00Z",
  });
  expect(window.rows).toEqual([]);
  expect(window.bundles).toEqual(["bundle"]);
  expect(
    (
      await q("window", {
        start: "2026-10-08T00:01Z",
        end: "2026-10-08T00:04Z",
      })
    ).bundles,
  ).toEqual(["bundle"]);
});
test("VC automatically stops after sixty days and requires an explicit bounded restart", async () => {
  const reservation = await q("reserve", {
    source: "vc_jmp",
    slot: 0,
    at: "2026-10-01T00:00Z",
  });
  expect(reservation.acquired).toBe(true);
  expect(
    (await q("reserve", { source: "vc_jmp", slot: 1, at: "2026-12-01T00:00Z" }))
      .review_due,
  ).toBe(true);
  await expect(q("vc_trial", { days: 999 })).rejects.toThrow();
  await q("vc_trial", { days: 30, at: "2026-12-02T00:00Z" });
  expect(
    (await q("reserve", { source: "vc_jmp", slot: 2, at: "2026-12-02T00:01Z" }))
      .acquired,
  ).toBe(true);
});
test("changing a report interval clears its prior forecast and measurements until each is rebuilt", async () => {
  await db.query("insert into auth.users(id) values($1)", [ALICE]);
  await db.query(
    "insert into public.outings(id,kind,title,starts_at,ends_at) values($1,'independent','Row','2026-09-10T12:00Z','2026-09-10T13:00Z')",
    [OUTING],
  );
  const id = crypto.randomUUID();
  await db.query(
    "insert into public.reports(id,outing_id,user_id,data) values($1,$2,$3,$4)",
    [id, OUTING, ALICE, report()],
  );
  await db.query(
    "insert into private.weather_features(outing_id,source_kind,features) values($1,'archived_forecast','{\"wind\":99}')",
    [OUTING],
  );
  const interval = {
    report_id: id,
    start: "2026-09-10T12:00Z",
    end: "2026-09-10T13:00Z",
  };
  await q("report_measurements_put", { ...interval, data: { sources: [] } });
  await q("report_forecast_put", {
    ...interval,
    features: { wind: 5 },
    source_kind: "archived_forecast",
  });
  expect(await q("own_measurements", { user_id: ALICE })).toHaveLength(1);
  await db.query(
    "update public.reports set data=jsonb_set(data,'{actual_start}','\"2026-09-10T12:15Z\"') where id=$1",
    [id],
  );
  expect(await q("own_measurements", { user_id: ALICE })).toEqual([]);
  expect(
    (
      await q("export_reports", {
        start: "2026-09-10T00:00Z",
        end: "2026-09-11T00:00Z",
      })
    )[0].forecast,
  ).toBeNull();
  await q("report_measurements_put", {
    ...interval,
    start: "2026-09-10T12:15Z",
    data: { sources: [] },
  });
  expect(
    (await q("own_measurements", { user_id: ALICE }))[0].conditions.forecast,
  ).toBeNull();
  const training = await db.query<any>(
    "select public.service_query('training_data','{}') result",
  );
  expect(training.rows[0].result).toEqual([]);
  await q("report_forecast_put", {
    ...interval,
    start: "2026-09-10T12:15Z",
    features: { wind: 7 },
    source_kind: "archived_forecast",
  });
  expect(
    (await q("own_measurements", { user_id: ALICE }))[0].conditions.forecast
      .wind,
  ).toBe(7);
});
