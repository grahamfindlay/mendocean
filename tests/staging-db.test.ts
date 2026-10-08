import { beforeAll, afterAll, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { ALICE, BOB } from "./fixtures";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.objects(bucket_id text,metadata jsonb);create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const name of readdirSync("supabase/migrations")
    .filter((n) => n.endsWith(".sql") && !n.includes("_storage"))
    .sort())
    await db.exec(
      readFileSync("supabase/migrations/" + name, "utf8").replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await db.query("insert into auth.users(id) values($1),($2)", [ALICE, BOB]);
  await db.exec("update profiles set approved=true,reminder_channel='email'");
  await db.exec(readFileSync("scripts/staging/fixtures.sql", "utf8"));
  await db.query(
    "insert into private.staging_environment(owner_id) values($1)",
    [ALICE],
  );
});
afterAll(async () => {
  await db?.close();
});

test("staging fixtures are owner-only and service-only, and avoid BHC polling", async () => {
  await expect(
    db.query("select public.staging_fixture($1)", [BOB]),
  ).rejects.toThrow("Staging owner required");
  const c = (
    await db.query<{ r: any }>("select public.staging_fixture($1) r", [ALICE])
  ).rows[0].r;
  expect(c.athlete).toBe(900000002);
  expect(
    (await db.query<{ r: any }>("select public.lineup_poll_candidates() r"))
      .rows[0].r,
  ).toEqual([]);
  expect(
    (
      await db.query<{ r: any }>(
        "select has_function_privilege('authenticated','public.staging_fixture(uuid)','execute') r",
      )
    ).rows[0].r,
  ).toBe(false);
  expect(
    (
      await db.query<{ r: any }>(
        "select has_function_privilege('anon','public.staging_claim()','execute') r",
      )
    ).rows[0].r,
  ).toBe(false);
  expect(
    (
      await db.query<{ r: any }>(
        "select has_function_privilege('service_role','public.staging_claim()','execute') r",
      )
    ).rows[0].r,
  ).toBe(true);
});
test("delayed staging delivery claims only owner lineup jobs and honors locks", async () => {
  const oid = "e746607c-f17f-4f59-833e-267f21fb7802";
  for (const [user, kind] of [
    [ALICE, "lineup_notify"],
    [ALICE, "bhc_sync"],
    [BOB, "lineup_notify"],
  ])
    await db.query(
      "insert into private.jobs(user_id,outing_id,kind,due_at,expires_at,dedupe_key) values($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour',$4)",
      [user, oid, kind, crypto.randomUUID()],
    );
  expect(
    (await db.query<{ r: any }>("select public.staging_delay($1) r", [ALICE]))
      .rows[0].r,
  ).toBe(1);
  expect(
    (await db.query<{ r: any }>("select public.staging_claim() r")).rows[0].r,
  ).toEqual([]);
  await db.query(
    "update private.jobs set due_at=now()-interval '1 second' where user_id=$1 and kind='lineup_notify'",
    [ALICE],
  );
  const jobs = (await db.query<{ r: any }>("select public.staging_claim() r"))
    .rows[0].r;
  expect(jobs).toHaveLength(1);
  expect(jobs[0].user_id).toBe(ALICE);
  expect(jobs[0].status).toBe("running");
  expect(
    (await db.query<{ r: any }>("select public.staging_claim() r")).rows[0].r,
  ).toEqual([]);
  await db.exec(
    "update private.jobs set locked_at=now()-interval '6 minutes' where status='running'",
  );
  expect(
    (await db.query<{ r: any }>("select public.staging_claim() r")).rows[0].r[0]
      .attempts,
  ).toBe(2);
});
