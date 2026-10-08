import { expect, test } from "vitest";
import { normalizeAttendanceRoster } from "../shared/attendanceRoster";

test("signup rosters include unassigned attendees before publication and omit the viewer, declines and unknowns", () => {
  const result = normalizeAttendanceRoster(
    {
      lineups_set: "No",
      attendance: [
        { custid: 1, fname: "You", attendance_plan: "Attending" },
        {
          custid: 3,
          fname: "Zoe",
          lname: "Reed",
          attendance_plan: "Attending",
          lineup_boat: null,
          phone: "private",
          email: "private@example.test",
        },
        {
          custid: "2",
          fname: "  Alex ",
          lname: "<b>Morgan</b>",
          attendance_plan: "attending",
          lineup_boat: 7,
          lineup_seat: "draft seat",
          weight: 180,
        },
        { custid: 2, fname: "Duplicate", attendance_plan: "Attending" },
        { custid: 4, fname: "Declined", attendance_plan: "Not Attending" },
        { custid: 5, fname: "Unknown", attendance_plan: "Unknown" },
        { custid: 6, fname: "Missing status" },
      ],
    },
    1,
  );
  expect(result).toEqual([
    { id: 2, name: "Alex Morgan" },
    { id: 3, name: "Zoe Reed" },
  ]);
});
test("a genuinely empty roster is distinct from missing or malformed provider data", () => {
  expect(normalizeAttendanceRoster({ attendance: [] }, 1)).toEqual([]);
  expect(
    normalizeAttendanceRoster(
      { attendance: [{ custid: 1, attendance_plan: "Attending" }] },
      1,
    ),
  ).toEqual([]);
  for (const attendance of [
    undefined,
    null,
    {},
    [null],
    [{ custid: "bad", attendance_plan: "Attending" }],
  ])
    expect(() => normalizeAttendanceRoster({ attendance }, 1)).toThrow(
      "unavailable",
    );
});
test("same-name attendees remain distinct and missing names have a readable fallback", () => {
  expect(
    normalizeAttendanceRoster(
      {
        attendance: [
          { custid: 2, fname: "Alex", attendance_plan: "Attending" },
          { custid: 3, fname: "Alex", attendance_plan: "Attending" },
          { custid: 4, attendance_plan: "Attending" },
        ],
      },
      1,
    ),
  ).toEqual([
    { id: 2, name: "Alex" },
    { id: 3, name: "Alex" },
    { id: 4, name: "Unnamed rower" },
  ]);
});
