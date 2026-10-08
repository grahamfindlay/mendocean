import { beforeAll, beforeEach, afterAll, expect, test } from "vitest";
import {
  api,
  sql,
  user,
  fixtures,
  tick,
  resetJobs,
  cleanupUsers,
  syntheticToken,
  createOuting,
  type Actor,
} from "../support/stack";
let actor: Actor, other: Actor;
let practice: any, outing: any;
const crew = [
  {
    custid: 501,
    fname: "Zoe",
    lname: "Reed",
    attendance_plan: "Attending",
    lineup_boat: null,
  },
  {
    custid: 502,
    fname: "Alex",
    lname: "Morgan",
    attendance_plan: "Attending",
    lineup_boat: 7,
    lineup_seat: "1",
    phone: "private",
    email: "private@example.test",
  },
  { custid: 503, fname: "Declined", attendance_plan: "Not Attending" },
  { custid: 504, fname: "Unknown", attendance_plan: "Unknown" },
];
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
    practice_id: Math.floor(Math.random() * 100000000) + 300000000,
    name: "Roster fixture",
    start_time: Math.floor(Date.now() / 1000) + 86400,
    end_time: Math.floor(Date.now() / 1000) + 90000,
    current_attendance_status: "Unknown",
    attendance_window_start: Math.floor(Date.now() / 1000) - 3600,
    attendance_window_end: Math.floor(Date.now() / 1000) + 3600,
    set_attendance_allowed: true,
    lineups_set: "No",
  };
  await fixtures({ bhc: [practice], crew });
  expect(
    (await api(actor, "bhc/connect", { token: syntheticToken })).status,
  ).toBe(200);
  await tick();
  outing = (
    await sql.query("select * from outings where bhc_practice_id=$1", [
      practice.practice_id,
    ])
  ).rows[0];
});
const roster = () =>
  api(actor, "bhc/attendance-roster", { outing_id: outing.id });
test("roster reads are private, name-only, independent of publication and the viewer's signup", async () => {
  const before = (
    await sql.query(
      "select attendance,reminder from outing_members where outing_id=$1",
      [outing.id],
    )
  ).rows;
  for (const current_attendance_status of [
    "Unknown",
    "Not Attending",
    "Attending",
  ]) {
    await fixtures({ bhc: [{ ...practice, current_attendance_status }] });
    const result = await roster();
    expect(result.status).toBe(200);
    expect(result.data.attendees).toEqual([
      { id: 502, name: "Alex Morgan" },
      { id: 501, name: "Zoe Reed" },
    ]);
    expect(Number.isFinite(Date.parse(result.data.checked_at))).toBe(true);
    expect(JSON.stringify(result.data)).not.toMatch(
      /private@example|lineup|phone|Fixture rower/,
    );
  }
  expect(
    (
      await sql.query(
        "select attendance,reminder from outing_members where outing_id=$1",
        [outing.id],
      )
    ).rows,
  ).toEqual(before);
  const state = await fixtures();
  expect(
    state.calls.filter((c: any) => c.path === "/practices/setAttendance"),
  ).toEqual([]);
  expect(state.deliveries).toEqual([]);
});
test("roster endpoints reject anonymous users, unrelated users, independent outings and caller identities", async () => {
  expect(
    (await api(null, "bhc/attendance-roster", { outing_id: outing.id })).status,
  ).toBe(401);
  expect(
    (await api(other, "bhc/attendance-roster", { outing_id: outing.id }))
      .status,
  ).toBe(404);
  expect(
    (
      await api(actor, "bhc/attendance-roster", {
        outing_id: (await createOuting(actor)).id,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await api(actor, "bhc/attendance-roster", {
        outing_id: outing.id,
        custid: 999,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await api(actor, "bhc/attendance-roster", {
        outing_id: outing.id,
        change: { attendance: "attending" },
      })
    ).status,
  ).toBe(400);
});
test("a roster error leaves attendance controls working and an actual empty roster succeeds", async () => {
  await fixtures({ failure: "lineup_read_failure" });
  expect((await roster()).status).toBe(502);
  expect(
    (await api(actor, "bhc/attendance", { outing_id: outing.id })).data.state
      .allowed,
  ).toBe(true);
  await fixtures({ failure: "roster_shape" });
  expect((await roster()).status).toBe(502);
  await fixtures({ failure: null, crew: [] });
  expect((await roster()).data.attendees).toEqual([]);
});
test("removed practices, lost membership and disconnected accounts never return saved names", async () => {
  await fixtures({ bhc: [] });
  expect((await roster()).status).toBe(409);
  await fixtures({ bhc: [practice], clubs: [] });
  const result = await roster();
  expect(result.status).toBe(409);
  expect(result.data.code).toBe("bhc_membership_missing");
  await api(actor, "bhc/disconnect", {});
  expect((await roster()).data.code).toBe("bhc_reconnect_required");
});
