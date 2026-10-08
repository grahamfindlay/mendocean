import { beforeAll, afterAll, beforeEach, expect, test } from "vitest";
import {
  api,
  db,
  sql,
  user,
  fixtures,
  tick,
  resetJobs,
  cleanupUsers,
  syntheticToken,
  type Actor,
} from "../support/stack";
let actor: Actor, other: Actor;
let practice: any;
beforeAll(async () => {
  actor = await user();
  other = await user();
});
afterAll(async () => {
  await cleanupUsers([actor, other]);
  await sql.end();
});
beforeEach(async () => {
  await api(actor, "bhc/disconnect", {});
  await resetJobs();
  practice = {
    practice_id: Math.floor(Math.random() * 100000000) + 100000000,
    name: "Masters lineup fixture",
    start_time: Math.floor(Date.now() / 1000) + 3600,
    end_time: Math.floor(Date.now() / 1000) + 7200,
    attendance_window_end: Math.floor(Date.now() / 1000) - 3600,
    current_attendance_status: "Attending",
    lineups_set: "No",
  };
  await fixtures({
    bhc: [practice],
    lineup: true,
    crew: [
      {
        custid: 500,
        fname: "Crewmate",
        lname: "One",
        attendance_plan: "Attending",
        lineup_boat: 7,
        lineup_seat: "1",
      },
    ],
  });
  await sql.query(
    "update profiles set lineup_channels=array['email','push'],lineup_changes='crew' where id=$1",
    [actor.id],
  );
  await sql.query(
    "insert into private.push_subscriptions(user_id,endpoint,subscription) values($1,'https://fcm.googleapis.com/fcm/send/lineup-fixture',$2) on conflict(endpoint) do update set subscription=excluded.subscription",
    [
      actor.id,
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/lineup-fixture",
        keys: { p256dh: "fixture", auth: "fixture" },
      },
    ],
  );
  expect(
    (await api(actor, "bhc/connect", { token: syntheticToken })).status,
  ).toBe(200);
  await tick();
});
async function poll(patch: Record<string, unknown> = {}) {
  await fixtures(patch);
  expect((await api(actor, "lineups/refresh", {})).status).toBe(200);
  // Manual refreshes are throttled; expire its key only inside this disposable test database.
  await tick();
  await sql.query(
    "delete from private.jobs where kind='lineup_poll' and user_id=$1 and status='done'",
    [actor.id],
  );
}
test("drafts stay private, publication sends full-crew email and direct-link push exactly once on successful retries", async () => {
  expect((await api(actor, "account")).data.lineups).toEqual([]);
  await poll({ bhc: [{ ...practice, lineups_set: "Yes" }] });
  const saved = (await api(actor, "account")).data.lineups;
  expect(saved).toHaveLength(1);
  expect(saved[0].boats[0].seats.map((s: any) => s.name)).toContain(
    "Crewmate One",
  );
  expect((await api(other, "account")).data.lineups).toEqual([]);
  await tick();
  let state = await fixtures();
  expect(state.deliveries).toHaveLength(2);
  const email = state.deliveries.find(
    (d: any) => d.channel === "email",
  ).payload;
  expect(email.text).toContain("Crewmate One");
  expect(email.html).toContain("View lineup");
  expect(email.html).toContain("mailto:coach%40example.test?subject=");
  expect(JSON.stringify(saved)).not.toMatch(/unrelated@example|phone_number/);
  expect(email.text).toContain(`tab=Lineups&lineup=${saved[0].outing_id}`);
  const push = state.deliveries.find((d: any) => d.channel === "push").payload;
  expect(push.url).toContain(`tab=Lineups&lineup=${saved[0].outing_id}`);
  await poll();
  await tick();
  state = await fixtures();
  expect(state.deliveries).toHaveLength(2);
});
test("crew edits notify only the user's boat, seat swaps and removal carry clear summaries", async () => {
  await poll({ bhc: [{ ...practice, lineups_set: "Yes" }] });
  await tick();
  await poll({
    crew: [
      {
        custid: 501,
        fname: "Replacement",
        attendance_plan: "Attending",
        lineup_boat: 7,
        lineup_seat: "1",
      },
    ],
  });
  await tick();
  let state = await fixtures();
  expect(state.deliveries).toHaveLength(4);
  await poll({
    own_assignment: { lineup_seat: "1" },
    crew: [
      {
        custid: 501,
        fname: "Replacement",
        attendance_plan: "Attending",
        lineup_boat: 7,
        lineup_seat: "2",
      },
    ],
  });
  await tick();
  state = await fixtures();
  expect(
    state.deliveries.at(-1).payload.body ||
      state.deliveries.at(-1).payload.text,
  ).toContain("from 2 to 1");
  await poll({ own_assignment: { lineup_boat: null } });
  await tick();
  state = await fixtures();
  expect(
    state.deliveries.at(-1).payload.body ||
      state.deliveries.at(-1).payload.text,
  ).toContain("removed");
});
test("provider rejection retries immutable email and checkpoints successful push devices", async () => {
  await poll({
    bhc: [{ ...practice, lineups_set: "Yes" }],
    failure: "email_failure",
  });
  await tick();
  let state = await fixtures();
  expect(state.deliveries).toHaveLength(1);
  expect(state.deliveries[0].channel).toBe("push");
  await fixtures({ failure: null });
  await sql.query(
    "update private.jobs set due_at=now()-interval '1 second' where kind='lineup_notify' and status='pending'",
  );
  await tick();
  state = await fixtures();
  expect(state.deliveries).toHaveLength(2);
  expect(
    state.attempts
      .filter((a: any) => a.channel === "email")
      .map((a: any) => a.key),
  ).toEqual([
    state.deliveries.find((a: any) => a.channel === "email").key,
    state.deliveries.find((a: any) => a.channel === "email").key,
  ]);
  expect(state.attempts.filter((a: any) => a.channel === "push")).toHaveLength(
    1,
  );
});
test("reconnection baselines, declines and disconnect prevent obsolete notifications", async () => {
  await poll({ bhc: [{ ...practice, lineups_set: "Yes" }] });
  await api(actor, "bhc/disconnect", {});
  await tick();
  expect((await fixtures()).deliveries).toHaveLength(0);
  expect((await api(actor, "account")).data.lineups).toEqual([]);
  await api(actor, "bhc/connect", { token: syntheticToken });
  await tick();
  await tick();
  expect((await fixtures()).deliveries).toHaveLength(0);
  expect((await api(actor, "account")).data.lineups).toHaveLength(1);
  await poll({
    bhc: [
      {
        ...practice,
        lineups_set: "Yes",
        current_attendance_status: "Not Attending",
      },
    ],
  });
  expect((await api(actor, "account")).data.lineups).toEqual([]);
});

test("temporary lineup failures retain the saved crew and recover without changing full-import state", async () => {
  await poll({ bhc: [{ ...practice, lineups_set: "Yes" }] });
  await sql.query(
    "update private.lineup_snapshots set checked_at=now()-interval '20 minutes' where user_id=$1",
    [actor.id],
  );
  await poll({ failure: "lineup_read_failure" });
  const failed = (await api(actor, "account")).data;
  expect(failed.lineups).toHaveLength(1);
  expect(failed.bhc.lineup_error).toContain("could not be checked");
  expect(failed.bhc.state).toBe("healthy");
  expect((await fixtures()).deliveries).toHaveLength(0);
  await fixtures({ failure: null });
  await sql.query(
    "update private.jobs set due_at=now()-interval '1 second' where kind in ('lineup_poll','lineup_notify') and user_id=$1 and status='pending'",
    [actor.id],
  );
  await tick();
  const recovered = (await api(actor, "account")).data;
  expect(recovered.lineups).toHaveLength(1);
  expect(recovered.bhc.lineup_error).toBeNull();
  expect(recovered.bhc.state).toBe("healthy");
  expect((await fixtures()).deliveries).toHaveLength(2);
});
