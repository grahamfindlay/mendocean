import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { ALICE, BOB, OUTING, report } from "./fixtures";
let db: PGlite;
const as = async (user: string, sql: string, params: unknown[] = []) => {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  return db.query(sql, params);
};
const admin = async (sql: string, params: unknown[] = []) => {
  await db.exec("reset role");
  return db.query(sql, params);
};
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.objects(bucket_id text,metadata jsonb);create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
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
  await admin("insert into auth.users values($1),($2)", [ALICE, BOB]);
  await admin("update public.profiles set approved=true");
});
afterAll(async () => {
  await db?.close();
});
describe("actual PostgreSQL permissions and transactions", () => {
  it("creates a retryable independent outing with its membership", async () => {
    const input = {
      id: OUTING,
      kind: "independent",
      title: "Fixture row",
      starts_at: "2026-09-10T12:00Z",
      ends_at: "2026-09-10T13:00Z",
      planned_boat: null,
      reminder: false,
    };
    await as(ALICE, "select public.create_outing($1)", [input]);
    await as(ALICE, "select public.create_outing($1)", [input]);
    const rows = await as(ALICE, "select * from public.outings");
    expect(rows.rows).toHaveLength(1);
    expect(
      (await as(ALICE, "select * from public.outing_members")).rows,
    ).toHaveLength(1);
    expect(
      (await as(ALICE, "select attendance from public.outing_members")).rows,
    ).toEqual([{ attendance: "attending" }]);
  });
  it("isolates other users and blocks private data and privilege escalation", async () => {
    expect((await as(BOB, "select * from public.outings")).rows).toHaveLength(
      0,
    );
    await expect(
      as(BOB, "update public.profiles set role='admin' where id=$1", [BOB]),
    ).rejects.toThrow();
    await expect(
      as(BOB, "select public.service_query('connections','{}')"),
    ).rejects.toThrow();
    await expect(
      as(BOB, "select * from private.bhc_connections"),
    ).rejects.toThrow();
  });
  it("rejects reports for outings the user has not joined", async () => {
    await expect(
      as(BOB, "select public.save_report($1,$2)", [OUTING, report()]),
    ).rejects.toThrow("Outing access denied");
  });
  it("deduplicates retry submissions and rejects stale edits", async () => {
    const input = report();
    const first = await as(
      ALICE,
      "select public.save_report($1,$2) as result",
      [OUTING, input],
    );
    const retry = await as(
      ALICE,
      "select public.save_report($1,$2) as result",
      [OUTING, input],
    );
    expect(first.rows).toEqual(retry.rows);
    expect((await as(ALICE, "select * from public.reports")).rows).toHaveLength(
      1,
    );
    await expect(
      as(ALICE, "select public.save_report($1,$2)", [OUTING, report()]),
    ).rejects.toThrow("changed elsewhere");
    await as(ALICE, "select public.save_report($1,$2)", [
      OUTING,
      report({ expected_version: 1, rating: 5 }),
    ]);
    const row = (await as(ALICE, "select * from public.reports"))
      .rows[0] as any;
    expect(row.version).toBe(2);
    expect(row.forced_off).toBe(true);
  });
  it("keeps individual reports private even inside shared outings", async () => {
    await admin(
      "insert into public.outing_members(outing_id,user_id) values($1,$2)",
      [OUTING, BOB],
    );
    expect((await as(BOB, "select * from public.outings")).rows).toHaveLength(
      1,
    );
    expect((await as(BOB, "select * from public.reports")).rows).toHaveLength(
      0,
    );
    await as(BOB, "select public.save_report($1,$2)", [
      OUTING,
      report({ rating: 1 }),
    ]);
    expect((await as(BOB, "select * from public.reports")).rows).toHaveLength(
      1,
    );
  });
  it("enforces observation constraints even with direct RPC calls", async () => {
    await expect(
      as(BOB, "select public.save_report($1,$2)", [
        OUTING,
        report({
          expected_version: 1,
          outcome: "did_not_attend",
          rating: null,
          boat_class: "1x",
        }),
      ]),
    ).rejects.toThrow();
    await expect(
      as(BOB, "select public.save_report($1,$2)", [
        OUTING,
        { submission_id: crypto.randomUUID(), expected_version: 1 },
      ]),
    ).rejects.toThrow();
  });
  it("rejects null rating and null optimistic version through direct RPC", async () => {
    await expect(
      as(BOB, "select public.save_report($1,$2)", [
        OUTING,
        report({ expected_version: 1, rating: null }),
      ]),
    ).rejects.toThrow();
    await expect(
      as(BOB, "select public.save_report($1,$2)", [
        OUTING,
        { ...report(), expected_version: null },
      ]),
    ).rejects.toThrow();
  });
  it("requires the right owner and version for deletion", async () => {
    const r = (await as(ALICE, "select * from public.reports")).rows[0] as any;
    await expect(
      as(BOB, "select public.delete_report($1,2)", [r.id]),
    ).rejects.toThrow();
    await expect(
      as(ALICE, "select public.delete_report($1,1)", [r.id]),
    ).rejects.toThrow();
    await as(ALICE, "select public.delete_report($1,2)", [r.id]);
    expect((await as(ALICE, "select * from public.reports")).rows).toHaveLength(
      0,
    );
    expect((await as(BOB, "select * from public.reports")).rows).toHaveLength(
      1,
    );
  });
  it("does not expose raw data to anonymous visitors", async () => {
    await db.exec("set role anon");
    await expect(db.query("select * from public.reports")).rejects.toThrow();
    await expect(
      db.query("select * from public.weather_runs"),
    ).rejects.toThrow();
    await expect(db.query("select * from public.outings")).rejects.toThrow();
  });
  it("keeps retries on one delivery channel and allows an explicitly snoozed reminder", async () => {
    const first = await admin(
      "select public.reserve_delivery($1,$2,0,'email') as r",
      [ALICE, OUTING],
    );
    expect((first.rows[0] as any).r.channel).toBe("email");
    const retry = await admin(
      "select public.reserve_delivery($1,$2,0,'push') as r",
      [ALICE, OUTING],
    );
    expect((retry.rows[0] as any).r.channel).toBe("email");
    await admin("select public.finish_delivery($1,$2,0)", [ALICE, OUTING]);
    expect(
      (
        (
          await admin("select public.reserve_delivery($1,$2,0,'email') as r", [
            ALICE,
            OUTING,
          ])
        ).rows[0] as any
      ).r.allowed,
    ).toBe(false);
    await admin(
      "update public.profiles set reminder_channel='email' where id=$1",
      [ALICE],
    );
    await admin("select public.reset_reminder($1,$2,true)", [ALICE, OUTING]);
    expect(
      (
        (
          await admin("select public.reserve_delivery($1,$2,0,'email') as r", [
            ALICE,
            OUTING,
          ])
        ).rows[0] as any
      ).r.allowed,
    ).toBe(false);
    expect(
      (
        (
          await admin("select public.reserve_delivery($1,$2,1,'email') as r", [
            ALICE,
            OUTING,
          ])
        ).rows[0] as any
      ).r.allowed,
    ).toBe(true);
    expect(
      (await admin("select * from private.delivery_budget")).rows,
    ).toHaveLength(2);
  });
  it("does not let a client join an official outing by claiming its UUID", async () => {
    const id = crypto.randomUUID();
    await admin(
      "insert into public.outings(id,kind,title,starts_at,ends_at,bhc_club_id,bhc_practice_id) values($1,'official','Practice','2026-09-12T12:00Z','2026-09-12T13:00Z',42,999)",
      [id],
    );
    await expect(
      as(BOB, "select public.create_outing($1)", [
        {
          id,
          kind: "independent",
          title: "Claim",
          starts_at: "2026-09-12T12:00Z",
          ends_at: "2026-09-12T13:00Z",
        },
      ]),
    ).rejects.toThrow("Outing access denied");
  });
  it("exports a consistent private training snapshot without report notes", async () => {
    await admin(
      "insert into private.weather_features(outing_id,source_kind,features) values($1,'fixture','{\"wind\":7,\"direction\":180}')",
      [OUTING],
    );
    const result = (
      await admin("select public.service_query('training_snapshot','{}') as s")
    ).rows[0] as any;
    expect(result.s.revision).toBeGreaterThan(0);
    expect(result.s.rows).toHaveLength(1);
    expect(result.s.rows[0].report.notes).toBeUndefined();
  });
  it("blocks an uninvited Auth user even if hosted signup were accidentally enabled", async () => {
    const stranger = crypto.randomUUID();
    await admin("insert into auth.users values($1)", [stranger]);
    await expect(
      as(stranger, "select public.create_outing($1)", [
        {
          id: crypto.randomUUID(),
          kind: "independent",
          title: "Uninvited",
          starts_at: "2026-09-12T12:00Z",
          ends_at: "2026-09-12T13:00Z",
        },
      ]),
    ).rejects.toThrow("invitation is required");
    await expect(
      as(stranger, "update public.profiles set approved=true where id=$1", [
        stranger,
      ]),
    ).rejects.toThrow();
  });
  it("retires a published model after a correction and rejects stale republication", async () => {
    const revision = (await admin("select revision from private.dataset_state"))
      .rows[0] as any;
    const id = crypto.randomUUID();
    await admin(
      "insert into private.model_runs(id,family,artifact,metrics) values($1,'fixture',$2,'{}')",
      [id, { eligible: true, dataset_revision: Number(revision.revision) }],
    );
    await admin("select public.service_query('model_publish',$1)", [
      { id, actor: ALICE },
    ]);
    expect(
      (
        (await admin("select status from private.model_runs where id=$1", [id]))
          .rows[0] as any
      ).status,
    ).toBe("active");
    await as(BOB, "select public.save_report($1,$2)", [
      OUTING,
      report({ expected_version: 1, rating: 3 }),
    ]);
    expect(
      (
        (await admin("select status from private.model_runs where id=$1", [id]))
          .rows[0] as any
      ).status,
    ).toBe("retired");
    await expect(
      admin("select public.service_query('model_publish',$1)", [
        { id, actor: ALICE },
      ]),
    ).rejects.toThrow("Training data changed");
  });
  it("merges a duplicate outing without losing reports and prevents overlapping reporters", async () => {
    const source = crypto.randomUUID();
    await as(ALICE, "select public.create_outing($1)", [
      {
        id: source,
        kind: "independent",
        title: "Duplicate",
        starts_at: "2026-09-10T12:00Z",
        ends_at: "2026-09-10T13:00Z",
      },
    ]);
    await as(ALICE, "select public.save_report($1,$2)", [source, report()]);
    await as(BOB, "select public.create_outing($1)", [
      {
        id: crypto.randomUUID(),
        kind: "independent",
        title: "Separate",
        starts_at: "2026-09-11T12:00Z",
        ends_at: "2026-09-11T13:00Z",
      },
    ]);
    await expect(
      as(ALICE, "select public.reconcile_outings($1,$2,$3)", [
        source,
        OUTING,
        ALICE,
      ]),
    ).rejects.toThrow();
    await admin("select public.reconcile_outings($1,$2,$3)", [
      source,
      OUTING,
      ALICE,
    ]);
    const moved = (
      await as(ALICE, "select * from public.reports where outing_id=$1", [
        OUTING,
      ])
    ).rows[0] as any;
    expect(moved.version).toBe(2);
    expect(
      (await admin("select * from public.reports where outing_id=$1", [OUTING]))
        .rows,
    ).toHaveLength(2);
    expect(
      (await admin("select * from public.outings where id=$1", [source])).rows,
    ).toHaveLength(0);
    const conflict = crypto.randomUUID();
    await as(ALICE, "select public.create_outing($1)", [
      {
        id: conflict,
        kind: "independent",
        title: "Conflicting",
        starts_at: "2026-09-10T12:00Z",
        ends_at: "2026-09-10T13:00Z",
      },
    ]);
    await as(ALICE, "select public.save_report($1,$2)", [conflict, report()]);
    await expect(
      admin("select public.reconcile_outings($1,$2,$3)", [
        conflict,
        OUTING,
        ALICE,
      ]),
    ).rejects.toThrow("reports on both outings");
    expect(
      (
        await admin("select * from public.reports where outing_id=$1", [
          conflict,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it("exposes model eligibility and revision freshness only to administrators", async () => {
    const { rows } = await admin("select revision from private.dataset_state");
    const revision = Number((rows[0] as any).revision);
    const fresh = crypto.randomUUID(),
      stale = crypto.randomUUID(),
      ineligible = crypto.randomUUID();
    for (const [id, artifact] of [
      [fresh, { eligible: true, dataset_revision: revision }],
      [stale, { eligible: true, dataset_revision: revision - 1 }],
      [ineligible, { eligible: false, dataset_revision: revision }],
    ]) {
      await admin(
        "insert into private.model_runs(id,family,artifact,metrics) values($1,'fixture',$2,'{}')",
        [id, artifact],
      );
    }
    const health = (await admin("select public.pilot_health() as health"))
      .rows[0] as any;
    expect(health.health.models.find((m: any) => m.id === fresh)).toMatchObject(
      { eligible: true, current_revision: true },
    );
    expect(health.health.models.find((m: any) => m.id === stale)).toMatchObject(
      { eligible: true, current_revision: false },
    );
    expect(
      health.health.models.find((m: any) => m.id === ineligible),
    ).toMatchObject({ eligible: false, current_revision: true });
    await expect(as(ALICE, "select public.pilot_health()")).rejects.toThrow();
  });
});
