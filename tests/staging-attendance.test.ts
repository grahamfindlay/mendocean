import { expect, test } from "vitest";
import { signupFixture } from "../supabase/functions/staging-test/attendance-fixture";
import { normalizeAttendanceRoster } from "../shared/attendanceRoster";

test("fictional signup data has no boat assignments or issued lineups and excludes self/declined/unknown", () => {
  const response = signupFixture(900000002);
  expect(response.lineups_set).toBe("No");
  expect(JSON.stringify(response.attendance)).not.toMatch(/lineup|boat|seat/);
  expect(
    normalizeAttendanceRoster(response, 900000002).map((p) => p.name),
  ).toEqual([
    "Jordan Ellis",
    "Micah Rivera",
    "Nora Sullivan",
    "Polyanna Nunes Da Silva",
  ]);
});
