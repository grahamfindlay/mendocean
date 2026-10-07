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

const rpc = async (name: string, args: unknown[]) =>
  (
    await db.query<{ r: any }>(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) r`,
      args,
    )
  ).rows[0].r;
let outing: string, revision: number;
const snapshot = (published = true, seat = "3", crew = 43) => ({
  published,
  title: "Masters",
  starts_at: new Date(Date.now() + 3600000).toISOString(),
  ends_at: new Date(Date.now() + 7200000).toISOString(),
  location: "Boathouse",
  athlete_id: 101,
  plan: "",
  boats: published
    ? [
        {
          boat_id: 7,
          name: "Pratt",
          boat_class: "8+",
          coaches: [],
          seats: [
            { athlete_id: 101, name: "Alice", seat, side: "port" },
            {
              athlete_id: crew,
              name: "Teammate",
              seat: "8",
              side: "starboard",
            },
          ],
        },
      ]
    : [],
});
async function save(
  published = true,
  assignment = "3",
  crew = "43",
  notify = true,
) {
  return rpc("lineup_save", [
    ALICE,
    revision,
    outing,
    snapshot(published, assignment, Number(crew)),
    assignment,
    assignment + ":" + crew,
    "Fixture change",
    notify,
  ]);
}
test("draft baseline, publication, stable polls, channel opt-ins and member isolation", async () => {
  await connect();
  revision = (await query("connection_get", { user_id: ALICE })).revision;
  await query("sync_lock", { user_id: ALICE, revision });
  await db.query(
    "update profiles set lineup_channels=array['email','push'] where id=$1",
    [ALICE],
  );
  outing = await rpc("apply_bhc_practice", [
    ALICE,
    revision,
    {
      bhc_club_id: 1,
      bhc_practice_id: 444,
      title: "Masters",
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      ends_at: new Date(Date.now() + 7200000).toISOString(),
      planned_coaches: [],
      planned_boats: [],
    },
    {
      attendance: "attending",
      deadline: new Date(Date.now() - 60000).toISOString(),
    },
  ]);
  expect(await save(false)).toBe(true);
  expect(await rpc("lineups_get", [ALICE])).toEqual([]);
  expect(
    (await db.query("select * from private.lineup_events")).rows,
  ).toHaveLength(0);
  await save();
  await save();
  expect((await rpc("lineups_get", [ALICE]))[0].boats[0].name).toBe("Pratt");
  expect(await rpc("lineups_get", [BOB])).toEqual([]);
  expect(
    (await db.query("select * from private.lineup_events")).rows,
  ).toHaveLength(1);
  expect(
    (await db.query("select * from private.jobs where kind='lineup_notify'"))
      .rows,
  ).toHaveLength(2);
  await db.exec("set role authenticated");
  await expect(
    db.query("select * from private.lineup_snapshots"),
  ).rejects.toThrow();
  await expect(rpc("lineups_get", [ALICE])).rejects.toThrow();
  await db.exec("reset role");
});
test("reservation leases, immutable email, devices and completed deliveries prevent retry duplicates", async () => {
  const event = (
    await db.query<{ id: string }>("select id from private.lineup_events")
  ).rows[0].id;
  const email = await rpc("lineup_reserve", [event, "email"]);
  expect(email.allowed).toBe(true);
  expect((await rpc("lineup_reserve", [event, "email"])).retry).toBe(true);
  expect(
    await rpc("lineup_prepare_email", [
      event,
      email.token,
      { text: "Original" },
    ]),
  ).toEqual({ text: "Original" });
  expect(
    await rpc("lineup_prepare_email", [
      event,
      email.token,
      { text: "Different" },
    ]),
  ).toEqual({ text: "Original" });
  await rpc("lineup_finish", [event, "email", email.token, "provider_failed"]);
  const retry = await rpc("lineup_reserve", [event, "email"]);
  expect(retry.key).toBe(email.key);
  expect(retry.payload).toEqual({ text: "Original" });
  await rpc("lineup_finish", [event, "email", retry.token, null]);
  expect((await rpc("lineup_reserve", [event, "email"])).allowed).toBe(false);
  const push = await rpc("lineup_reserve", [event, "push"]);
  await rpc("lineup_finish_device", [
    event,
    push.token,
    "https://fixture.test/device",
  ]);
  await rpc("lineup_finish", [event, "push", push.token, "provider_failed"]);
  expect((await rpc("lineup_reserve", [event, "push"])).devices).toEqual([
    "https://fixture.test/device",
  ]);
});
test("seat moves and removals supersede claimed alerts; unpublication hides cached crews", async () => {
  const old = (
    await db.query<{ id: string }>(
      "select id from private.lineup_events order by created_at desc limit 1",
    )
  ).rows[0].id;
  await save(true, "5");
  expect((await rpc("lineup_reserve", [old, "push"])).allowed).toBe(false);
  const moved = (
    await db.query<{ id: string; kind: string }>(
      "select id,kind from private.lineup_events order by created_at desc limit 1",
    )
  ).rows[0];
  expect(moved.kind).toBe("assignment");
  const lease = await rpc("lineup_reserve", [moved.id, "email"]);
  await save(true, "none");
  expect(
    await rpc("lineup_delivery_active", [moved.id, "email", lease.token, null]),
  ).toBe(false);
  await save(false);
  expect(await rpc("lineups_get", [ALICE])).toEqual([]);
});
test("crew-only changes respect the assignment-only preference", async () => {
  await save(true, "3", "43", false);
  await db.query(
    "update profiles set lineup_changes='assignment' where id=$1",
    [ALICE],
  );
  await save(true, "3", "44");
  const event = (
    await db.query<{ id: string; kind: string }>(
      "select id,kind from private.lineup_events order by created_at desc limit 1",
    )
  ).rows[0];
  expect(event.kind).toBe("crew");
  expect(
    (
      await db.query(
        "select * from private.lineup_deliveries where event_id=$1",
        [event.id],
      )
    ).rows,
  ).toHaveLength(0);
});
test("reconnect baselines and stale workers cannot expose or notify old revisions", async () => {
  await query("sync_unlock", { user_id: ALICE, revision });
  const stale = revision;
  await connect();
  revision = (await query("connection_get", { user_id: ALICE })).revision;
  expect(await rpc("lineups_get", [ALICE])).toEqual([]);
  await query("sync_lock", { user_id: ALICE, revision });
  await db.query("update outing_members set bhc_revision=$1 where user_id=$2", [
    revision,
    ALICE,
  ]);
  expect(
    await rpc("lineup_save", [
      ALICE,
      stale,
      outing,
      snapshot(),
      "9",
      "9",
      "Old worker",
      true,
    ]),
  ).toBe(false);
  const before = (await db.query("select * from private.lineup_events")).rows
    .length;
  await save(true, "5", "43");
  expect(
    (await db.query("select * from private.lineup_events")).rows,
  ).toHaveLength(before);
});
test("declines, expired credentials, stale data and disconnect suppress delivery", async () => {
  await db.query("update profiles set lineup_changes='crew' where id=$1", [
    ALICE,
  ]);
  await save(true, "7");
  const event = (
    await db.query<{ id: string }>(
      "select id from private.lineup_events order by created_at desc limit 1",
    )
  ).rows[0].id;
  const lease = await rpc("lineup_reserve", [event, "email"]);
  expect(lease.allowed).toBe(true);
  await db.query(
    "update outing_members set attendance='declined' where user_id=$1",
    [ALICE],
  );
  expect(
    await rpc("lineup_delivery_active", [event, "email", lease.token, null]),
  ).toBe(false);
  expect(await rpc("lineups_get", [ALICE])).toEqual([]);
  await db.query(
    "update outing_members set attendance='attending' where user_id=$1",
    [ALICE],
  );
  await db.query(
    "update private.lineup_snapshots set checked_at=now()-interval '20 minutes'",
  );
  expect(await rpc("lineup_reserve", [event, "push"])).toMatchObject({
    allowed: false,
    retry: true,
  });
  expect(
    await rpc("lineup_delivery_active", [event, "email", lease.token, null]),
  ).toBe(false);
  await db.query("update private.lineup_snapshots set checked_at=now()");
  await db.query(
    "update private.bhc_connections set expires_at=now()-interval '1 second' where user_id=$1",
    [ALICE],
  );
  expect(
    await rpc("lineup_delivery_active", [event, "email", lease.token, null]),
  ).toBe(false);
  await query("connection_delete", { user_id: ALICE });
  expect(await rpc("lineups_get", [ALICE])).toEqual([]);
});

test("lineup and logging emails reserve the same daily allowance", async () => {
  await db.exec("truncate private.lineup_events cascade");
  await connect();
  revision = (await query("connection_get", { user_id: ALICE })).revision;
  await query("sync_lock", { user_id: ALICE, revision });
  await db.query("update outing_members set bhc_revision=$1 where user_id=$2", [
    revision,
    ALICE,
  ]);
  await save(false);
  await save(true);
  const event = (
    await db.query<{ id: string }>("select id from private.lineup_events")
  ).rows[0].id;
  await db.query(
    `with events as (
    insert into private.lineup_events(user_id,outing_id,connection_revision,version,kind,summary,snapshot)
    select $1,$2,$3,100+g,'published','Budget fixture','{}' from generate_series(1,80) g returning id
  ) insert into private.lineup_deliveries(event_id,channel,reserved_at) select id,'email',now() from events`,
    [ALICE, outing, revision],
  );
  expect(await rpc("lineup_reserve", [event, "email"])).toMatchObject({
    allowed: false,
    retry: true,
  });
  const independent = crypto.randomUUID();
  await db.query(
    "insert into outings(id,kind,title,starts_at,ends_at) values($1,'independent','Budget row',now()-interval '2 hours',now()-interval '1 hour')",
    [independent],
  );
  await db.query(
    "insert into outing_members(user_id,outing_id,attendance,reminder) values($1,$2,'attending',true)",
    [ALICE, independent],
  );
  expect(
    await rpc("reserve_reminder_channel", [ALICE, independent, 0, "email"]),
  ).toMatchObject({ allowed: false, quota: true });
  await db.query("delete from private.lineup_events where version=101");
  expect((await rpc("lineup_reserve", [event, "email"])).allowed).toBe(true);
  expect(
    await rpc("reserve_reminder_channel", [ALICE, independent, 0, "email"]),
  ).toMatchObject({ allowed: false, quota: true });
});
