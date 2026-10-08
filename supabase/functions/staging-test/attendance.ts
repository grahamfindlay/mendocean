import { z } from "zod";
import { normalizeAttendanceRoster } from "../../../shared/attendanceRoster.ts";
import type { AttendanceState } from "../../../shared/bhc.ts";
import {
  check,
  HttpError,
  query,
  service,
  userClient,
} from "../_shared/runtime.ts";
import { attendanceFixtureId, signupFixture } from "./attendance-fixture.ts";

// Called only after staging URL/environment and sole-owner authentication guards.
export async function stagingPracticeAttendance(
  uid: string,
  authorization: string,
  input: unknown,
  now: number,
) {
  const parsed = z
    .object({
      action: z.enum(["attendance", "attendance-roster"]),
      outing_id: z.enum([
        "e746607c-f17f-4f59-833e-267f21fb7802",
        attendanceFixtureId,
      ]),
      change: z
        .object({
          attendance: z.enum(["attending", "declined"]),
          expected: z.enum(["attending", "declined", "unknown"]),
          request_id: z.string().uuid(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .parse(input);
  const client = userClient(authorization);
  const outing = check(
    await client
      .from("outings")
      .select("*")
      .eq("id", parsed.outing_id)
      .maybeSingle(),
  );
  const member = check(
    await client
      .from("outing_members")
      .select("*")
      .eq("outing_id", parsed.outing_id)
      .eq("user_id", uid)
      .maybeSingle(),
  );
  if (!outing || !member) throw new HttpError(404, "Practice not found.");
  const connection = await query("connection_get", { user_id: uid });
  if (
    !connection.user_id ||
    connection.access_state !== "active" ||
    Number(connection.club_id) !== 900000001 ||
    Number(outing.bhc_practice_id) !==
      (outing.id === attendanceFixtureId ? 900000004 : 900000003)
  )
    throw new HttpError(
      409,
      "The fictional staging connection is unavailable.",
    );
  if (parsed.action === "attendance-roster") {
    if (parsed.change)
      throw new HttpError(400, "Attendance lists are read-only.");
    return {
      attendees: normalizeAttendanceRoster(
        signupFixture(Number(connection.custid)),
        Number(connection.custid),
      ),
      checked_at: new Date(now).toISOString(),
    };
  }
  const closed = now >= Date.parse(member.deadline || outing.starts_at);
  const state: AttendanceState = {
    attendance: member.attendance,
    allowed: !closed,
    reason: closed ? "The attendance deadline has passed." : null,
    opens_at: null,
    deadline: member.deadline || outing.starts_at,
    checked_at: new Date(now).toISOString(),
  };
  if (!parsed.change) return { state, outcome: "checked" };
  if (state.attendance === parsed.change.attendance)
    return { state, outcome: "confirmed" };
  if (state.attendance !== parsed.change.expected)
    return {
      state,
      outcome: "conflict",
      message:
        "Attendance changed. Check its current status before choosing again.",
    };
  if (!state.allowed)
    return { state, outcome: "blocked", message: state.reason };
  // Explicit saves affect only the fictional owner's membership. No BHC write,
  // sync, fixture reset, publication event, or notification is created.
  check(
    await service()
      .from("outing_members")
      .update({ attendance: parsed.change.attendance })
      .eq("outing_id", outing.id)
      .eq("user_id", uid),
  );
  return {
    state: { ...state, attendance: parsed.change.attendance },
    outcome: "confirmed",
  };
}
