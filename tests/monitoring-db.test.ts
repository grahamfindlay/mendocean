import { beforeAll, afterAll, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
let db: PGlite;
const A = crypto.randomUUID(),
  B = crypto.randomUUID(),
  OWNER = crypto.randomUUID();
const query = async (action: string, args = {}) =>
  (
    await db.query<{ result: any }>(
      "select public.monitoring_query($1,$2) result",
      [action, args],
    )
  ).rows[0].result;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.objects(bucket_id text,metadata jsonb);create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql") && !f.includes("_storage"))
    .sort())
    await db.exec(
      readFileSync(`supabase/migrations/${file}`, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    A,
    B,
    OWNER,
  ]);
  await db.query(
    "update profiles set approved=true,role=case when id=$1 then 'admin' else 'member' end",
    [OWNER],
  );
});
afterAll(async () => db?.close());
test("dispatcher timestamps accept the injected clock", async () => {
  await query("tick_started", { at: "2026-10-05T13:05:00.000Z" });
  await query("tick_completed", { at: "2026-10-05T13:05:01.000Z" });
  const state = (await db.query<any>("select * from private.monitoring_state"))
    .rows[0];
  expect(state.last_tick_started_at.toISOString()).toBe(
    "2026-10-05T13:05:00.000Z",
  );
});
test("members/anonymous cannot read private observations or invoke the privileged RPC", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await expect(query("activity")).rejects.toThrow();
    await expect(db.query("select * from private.activity")).rejects.toThrow();
    await db.exec("reset role");
  }
});
test("account email lookup is restricted to the service role and requested accounts", async () => {
  await db.query("update auth.users set email=$1 where id=$2", [
    "pilot@example.test",
    B,
  ]);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await expect(
      db.query("select * from public.admin_account_emails($1)", [[B]]),
    ).rejects.toThrow("permission denied");
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  try {
    expect(
      (await db.query("select * from public.admin_account_emails($1)", [[B]]))
        .rows,
    ).toEqual([{ id: B, email: "pilot@example.test" }]);
    expect(
      (await db.query("select * from public.admin_account_emails($1)", [[]]))
        .rows,
    ).toEqual([]);
  } finally {
    await db.exec("reset role");
  }
  expect(JSON.stringify(await query("activity"))).not.toContain(
    "pilot@example.test",
  );
});

test("foreground observations throttle on the server and do not record supplied data", async () => {
  await query("observe", { user_id: A, notes: "secret" });
  await query("observe", { user_id: A });
  const timeline = await query("timeline", { user_id: A });
  expect(timeline.events).toHaveLength(1);
  expect(timeline.events[0].details).toEqual({});
  await db.query(
    "update private.user_observations set last_foreground_at=now()-interval '16 minutes' where user_id=$1",
    [A],
  );
  await query("observe", { user_id: A });
  expect((await query("timeline", { user_id: A })).events).toHaveLength(2);
});
test("background outcomes do not inflate active users, and summaries exclude the owner", async () => {
  await db.query("select private.record_activity($1,'bhc_synced')", [B]);
  await db.query("select private.record_activity($1,'report_created')", [
    OWNER,
  ]);
  await db.query("select private.record_activity($1,'report_created')", [A]);
  const summary = await query("summary", {
    start: "2000-01-01T00:00:00Z",
    end: "2000-01-08T00:00:00Z",
  });
  expect(summary.active_users).toBe(0);
  const current = await db.query<{ start: string; end: string }>(
    "select date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago' as start,(date_trunc('day',now() at time zone 'America/Chicago')+interval '1 day') at time zone 'America/Chicago' as end",
  );
  const today = await query("summary", current.rows[0]);
  expect(today.active_users).toBe(1);
  expect(today.reports_created).toBe(1);
  expect(today.contributors).toBe(1);
  const activity = await query("activity");
  expect(
    activity.users.find((u: any) => u.id === B).last_observed_at,
  ).toBeNull();
});
test("digest leases, idempotent content and completed sends prevent duplicates", async () => {
  const week = "2026-10-05";
  const first = await query("digest_reserve", {
    week,
    payload: { text: "first" },
  });
  expect(first.allowed).toBe(true);
  expect(
    (await query("digest_reserve", { week, payload: { text: "replacement" } }))
      .allowed,
  ).toBe(false);
  await query("digest_finish", {
    week,
    lease: crypto.randomUUID(),
    sent: true,
  });
  expect((await query("digest_reserve", { week, payload: {} })).allowed).toBe(
    false,
  );
  await query("digest_finish", { week, lease: first.lease, sent: false });
  const retry = await query("digest_reserve", {
    week,
    payload: { text: "replacement" },
  });
  expect(retry.allowed).toBe(true);
  expect(retry.payload).toEqual({ text: "first" });
  await query("digest_finish", { week, lease: retry.lease, sent: true });
  expect((await query("digest_reserve", { week, payload: {} })).allowed).toBe(
    false,
  );
});
test("only eligible overdue jobs count, and lease releases do not count as failures", async () => {
  await db.exec(
    "insert into private.jobs(kind,due_at,expires_at,dedupe_key) values('weather',now()-interval '30 minutes',now()+interval '1 day','overdue'),('weather',now()+interval '30 minutes',now()+interval '1 day','future'),('weather',now()-interval '30 minutes',now()-interval '1 minute','expired')",
  );
  expect((await query("operations")).overdue_jobs).toBe(1);
  await db.exec(
    "update private.jobs set status='running',attempts=1,locked_at=now() where dedupe_key='overdue';update private.jobs set status='pending',attempts=0,locked_at=null where dedupe_key='overdue'",
  );
  expect((await query("operations")).retries_24h).toBe(0);
  await db.exec(
    "update private.jobs set status='running',attempts=1 where dedupe_key='overdue';update private.jobs set status='pending',last_error='safe failure' where dedupe_key='overdue'",
  );
  expect((await query("operations")).retries_24h).toBe(1);
});
test("timeline pagination and retention preserve aggregate history, account deletion removes identities", async () => {
  for (let i = 0; i < 55; i++)
    await db.query("select private.record_activity($1,'app_observed')", [A]);
  const first = await query("timeline", { user_id: A });
  const next = await query("timeline", {
    user_id: A,
    before: first.events.at(-1).id,
  });
  expect(first.events).toHaveLength(50);
  expect(next.events.length).toBeGreaterThan(0);
  expect(next.events.every((e: any) => e.id < first.events.at(-1).id)).toBe(
    true,
  );
  await db.exec(
    "update private.activity set at=now()-interval '91 days';update private.operational_events set at=now()-interval '31 days'",
  );
  await db.exec("update private.monitoring_state set last_cleanup_at=null");
  await query("tick_completed");
  expect((await query("timeline", { user_id: A })).events).toHaveLength(0);
  expect(
    (await db.query("select * from private.activity_days")).rows.length,
  ).toBeGreaterThan(0);
  await db.query("delete from auth.users where id=$1", [A]);
  expect(
    (
      await db.query(
        "select * from private.user_observations where user_id=$1",
        [A],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query("select * from private.activity_days where user_id=$1", [
        A,
      ])
    ).rows,
  ).toHaveLength(0);
});
