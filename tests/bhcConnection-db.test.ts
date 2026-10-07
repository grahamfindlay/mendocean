import { beforeAll, afterAll, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { ALICE, BOB } from "./fixtures";
let db: PGlite;
async function query(action: string, args: Record<string, unknown> = {}) {
  return (
    await db.query<{ r: any }>("select public.service_query($1,$2) r", [
      action,
      args,
    ])
  ).rows[0].r;
}
async function begin(user_id = ALICE) {
  const request_id = crypto.randomUUID();
  return {
    user_id,
    request_id,
    ...(await query("bhc_connect_begin", {
      user_id,
      request_id,
      method: "provided_token",
    })),
  };
}
async function connect(user_id = ALICE) {
  const attempt = await begin(user_id);
  expect(attempt.status).toBe("started");
  return query("connection_put", {
    ...attempt,
    custid: 101,
    club_id: 1,
    method: "provided_token",
    ciphertext: "sealed-fixture",
    iv: "fixture",
  });
}
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
  await query("bhc_configure", { club_id: 1 });
});
afterAll(async () => {
  await db?.close();
});
test("pinning is permanent and connection requests are serialized/idempotent", async () => {
  await expect(query("bhc_configure", { club_id: 2 })).rejects.toThrow(
    "already pinned",
  );
  const attempt = await begin();
  expect(attempt.status).toBe("started");
  expect((await begin()).status).toBe("busy");
  expect(await query("bhc_connect_begin", attempt)).toEqual({
    status: "running",
  });
  expect(
    await query("connection_put", {
      ...attempt,
      custid: 101,
      club_id: 1,
      method: "provided_token",
      ciphertext: "sealed-fixture",
      iv: "fixture",
    }),
  ).toEqual({ saved: true });
  expect(await query("bhc_connect_begin", attempt)).toEqual({
    status: "completed",
  });
  expect(
    (await db.query("select * from private.jobs where kind='bhc_sync'")).rows,
  ).toHaveLength(1);
});
test("failed replacement preserves credentials and blocks changing the athlete or linking it twice", async () => {
  const before = await query("connection_get", { user_id: ALICE });
  const attempt = await begin();
  expect(
    await query("connection_put", { ...attempt, custid: 202, club_id: 1 }),
  ).toMatchObject({ saved: false, different_account: true });
  await query("bhc_connect_fail", attempt);
  const after = await query("connection_get", { user_id: ALICE });
  expect(after.ciphertext).toBe(before.ciphertext);
  expect(after.revision).toBe(before.revision);
  expect(after.sync_locked_until).toBeNull();
  const duplicate = await begin(BOB);
  expect(
    await query("connection_put", { ...duplicate, custid: 101, club_id: 1 }),
  ).toMatchObject({ saved: false, already_linked: true });
  await query("bhc_connect_fail", duplicate);
});
test("only a leased current revision imports; expiry stops official reminders even after reservation", async () => {
  const connection = await query("connection_get", { user_id: ALICE });
  const apply = () =>
    db.query<{ id: string | null }>(
      "select public.apply_bhc_practice($1,$2,$3,$4) id",
      [
        ALICE,
        connection.revision,
        {
          bhc_club_id: 1,
          bhc_practice_id: 333,
          title: "Fixture practice",
          starts_at: new Date(Date.now() - 7200000).toISOString(),
          ends_at: new Date(Date.now() - 3600000).toISOString(),
          planned_coaches: [],
          planned_boats: [],
        },
        { attendance: "attending", deadline: null },
      ],
    );
  expect((await apply()).rows[0].id).toBeNull();
  expect(
    await query("sync_lock", { user_id: ALICE, revision: connection.revision }),
  ).toEqual({ acquired: true });
  const id = (await apply()).rows[0].id;
  expect(id).toBeTruthy();
  await query("connection_synced", {
    user_id: ALICE,
    revision: connection.revision,
    error: null,
  });
  const reservation = (
    await db.query<{ r: any }>(
      "select public.reserve_reminder_channel($1,$2,0,'email') r",
      [ALICE, id],
    )
  ).rows[0].r;
  expect(reservation.allowed).toBe(true);
  await db.query(
    "update private.bhc_connections set expires_at=now()-interval '1 second' where user_id=$1",
    [ALICE],
  );
  expect((await query("connection_get", { user_id: ALICE })).access_state).toBe(
    "reconnect_required",
  );
  expect(
    (
      await db.query<{ allowed: boolean }>(
        "select public.reminder_channel_active($1,$2,0,'email',$3) allowed",
        [ALICE, id, reservation.token],
      )
    ).rows[0].allowed,
  ).toBe(false);
  expect((await apply()).rows[0].id).toBeNull();
  await query("sync_unlock", { user_id: ALICE, revision: connection.revision });
});
test("disconnect erases credentials, cancels in-flight connection setup, and prevents old workers from returning", async () => {
  const stale = await begin();
  await query("connection_delete", { user_id: ALICE });
  expect(await query("connection_get", { user_id: ALICE })).toEqual({});
  const row = (
    await db.query<{ ciphertext: string; iv: string; revision: number }>(
      "select ciphertext,iv,revision from private.bhc_connections where user_id=$1",
      [ALICE],
    )
  ).rows[0];
  expect(row.ciphertext).toBe("");
  expect(row.iv).toBe("");
  expect(
    await query("connection_put", { ...stale, custid: 101, club_id: 1 }),
  ).toEqual({ saved: false });
  expect(await connect()).toEqual({ saved: true });
  const current = await query("connection_get", { user_id: ALICE });
  expect(current.revision).toBeGreaterThan(row.revision);
  expect(
    await query("sync_lock", { user_id: ALICE, revision: stale.revision }),
  ).toEqual({ acquired: false });
  expect(
    await query("sync_lock", { user_id: ALICE, revision: current.revision }),
  ).toEqual({ acquired: true });
  await query("sync_unlock", { user_id: ALICE, revision: stale.revision });
  expect(
    (await query("connection_get", { user_id: ALICE })).sync_locked_until,
  ).toBeTruthy();
  await query("sync_unlock", { user_id: ALICE, revision: current.revision });
});
test("connection attempts are throttled and clients cannot read the journal/configuration", async () => {
  await db.exec("truncate private.bhc_connect_requests");
  for (let i = 0; i < 5; i++) {
    const attempt = await begin();
    expect(attempt.status).toBe("started");
    await query("bhc_connect_fail", attempt);
  }
  expect((await begin()).status).toBe("limited");
  await db.exec("set role authenticated");
  await expect(
    db.query("select * from private.bhc_connect_requests"),
  ).rejects.toThrow();
  await expect(
    db.query("select public.apply_bhc_practice($1,1,'{}','{}')", [ALICE]),
  ).rejects.toThrow();
  await db.exec("reset role");
});
test("a late failed request cannot release the newer setup lease",async()=>{
  await db.exec("truncate private.bhc_connect_requests");
  const stale=await begin();
  await db.query("update private.bhc_connect_requests set started_at=now()-interval '3 minutes' where request_id=$1",[stale.request_id]);
  await db.query("update private.bhc_connections set sync_locked_until=now()-interval '1 second' where user_id=$1",[ALICE]);
  const current=await begin();
  expect(current.status).toBe("started");
  await query("bhc_connect_fail",stale);
  expect((await query("connection_get",{user_id:ALICE})).sync_locked_until).toBeTruthy();
  expect(await query("sync_lock",{user_id:ALICE,revision:current.revision})).toEqual({acquired:false});
  await query("bhc_connect_fail",current);
  expect((await query("connection_get",{user_id:ALICE})).sync_locked_until).toBeNull();
});
