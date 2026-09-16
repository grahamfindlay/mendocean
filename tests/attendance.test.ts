import { expect, test } from "vitest";
import { attendanceState } from "../shared/bhc";
const now = Date.parse("2026-09-16T15:00:00Z");
const meta = {
  start_time: (now + 86400000) / 1000,
  attendance_window_start: (now - 3600000) / 1000,
  attendance_window_end: (now + 3600000) / 1000,
  set_attendance_allowed: true,
  current_attendance_status: "Not Attending",
};
test("attendance eligibility uses provider flag and exact window boundaries", () => {
  expect(attendanceState(meta, now)).toMatchObject({
    allowed: true,
    attendance: "declined",
  });
  expect(attendanceState(meta, now + 3600000).allowed).toBe(false);
  expect(attendanceState(meta, now - 3600001).allowed).toBe(false);
  expect(attendanceState(meta, now - 3600000).allowed).toBe(true);
  for (const set_attendance_allowed of [false, undefined, "true", 1])
    expect(
      attendanceState({ ...meta, set_attendance_allowed }, now).allowed,
    ).toBe(false);
  for (const attendance_window_end of [undefined, 0, "bad"])
    expect(
      attendanceState({ ...meta, attendance_window_end }, now).allowed,
    ).toBe(false);
  expect(
    attendanceState({ ...meta, start_time: now / 1000 }, now).allowed,
  ).toBe(false);
  expect(
    attendanceState({ ...meta, current_attendance_status: null }, now)
      .attendance,
  ).toBe("unknown");
});
