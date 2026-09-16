import { test, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
test("migration preserves exact preferences, sent history and in-flight provider keys", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.objects(bucket_id text,metadata jsonb);create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;",
    );
    const migrations = readdirSync("supabase/migrations")
      .filter((n) => n.endsWith(".sql") && !n.includes("_storage"))
      .sort();
    for (const name of migrations.filter((n) => !n.includes("multi_channel")))
      await db.exec(
        readFileSync("supabase/migrations/" + name, "utf8").replace(
          "create extension if not exists pgcrypto;",
          "",
        ),
      );
    const users = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    for (const [i, channel] of ["none", "email", "push"].entries()) {
      await db.query("insert into auth.users values($1)", [users[i]]);
      await db.query(
        "update profiles set reminder_channel=$1,approved=true where id=$2",
        [channel, users[i]],
      );
    }
    const outing = crypto.randomUUID();
    await db.query(
      "insert into outings(id,kind,title,starts_at,ends_at) values($1,'independent','Migration fixture',now()-interval '2 hours',now()-interval '1 hour')",
      [outing],
    );
    await db.query(
      "insert into outing_members(user_id,outing_id,attendance,reminder) values($1,$2,'attending',true)",
      [users[1], outing],
    );
    await db.query(
      "insert into private.deliveries(user_id,outing_id,channel,generation) values($1,$2,'email',3)",
      [users[1], outing],
    );
    await db.query(
      "insert into private.delivery_budget(user_id,outing_id,generation,channel) values($1,$2,3,'email')",
      [users[1], outing],
    );
    await db.query(
      "insert into private.deliveries(user_id,outing_id,channel,sent_at) values($1,$2,'push',now())",
      [users[2], outing],
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/" +
          migrations.find((n) => n.includes("multi_channel")),
        "utf8",
      ),
    );
    for (const [i, channels] of [[], ["email"], ["push"]].entries()) {
      expect(
        (
          await db.query<{ reminder_channels: string[] }>(
            "select reminder_channels from profiles where id=$1",
            [users[i]],
          )
        ).rows[0].reminder_channels,
      ).toEqual(channels);
    }
    const reserve = (
      await db.query<{ r: { allowed: boolean; key: string } }>(
        "select public.reserve_reminder_channel($1,$2,3,'email') r",
        [users[1], outing],
      )
    ).rows[0].r;
    expect(reserve.allowed).toBe(true);
    const status = (
      await db.query<{ r: any }>("select public.reminder_states($1) r", [
        users[1],
      ])
    ).rows[0].r;
    expect(status[0].channels[0].channel).toBe("email");
    expect(
      (
        await db.query<{ r: any }>(
          "select public.reserve_reminder_channel($1,$2,3,'email') r",
          [users[1], outing],
        )
      ).rows[0].r.busy,
    ).toBe(true);
    await db.query("select public.refresh_reminder_jobs($1)", [users[1]]);
    expect(
      (
        await db.query(
          "select * from private.jobs where user_id=$1 and kind='reminder'",
          [users[1]],
        )
      ).rows,
    ).toHaveLength(1);

    expect(reserve.key).toBe(`reminder/${users[1]}/${outing}/3`);
    expect(
      (await db.query("select * from private.delivery_budget")).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query<{ sent_at: string }>(
          "select sent_at from private.reminder_channels where user_id=$1",
          [users[2]],
        )
      ).rows[0].sent_at,
    ).toBeTruthy();
    await db.query(
      "update profiles set reminder_channels=array['email','push'] where id=$1",
      [users[0]],
    );
    expect(
      (
        await db.query<{ reminder_channels: string[] }>(
          "select reminder_channels from profiles where id=$1",
          [users[0]],
        )
      ).rows[0].reminder_channels,
    ).toEqual(["email", "push"]);
  } finally {
    await db.close();
  }
});
