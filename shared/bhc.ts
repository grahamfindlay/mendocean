import { BOAT_CLASSES } from "./domain.ts";
export type BHCRecord = Record<string, any>;
export function bhcAttendance(
  value: unknown,
): "attending" | "declined" | "unknown" {
  const text = String(value ?? "")
    .toLowerCase()
    .trim();
  return text === "attending"
    ? "attending"
    : ["not attending", "declined", "not_attending"].includes(text)
      ? "declined"
      : "unknown";
}
export function bhcBoatClass(
  boat: BHCRecord | undefined,
): (typeof BOAT_CLASSES)[number] | null {
  if (!boat) return null;
  const n = Number(boat.boat_type);
  if (![1, 2, 4, 8].includes(n)) return null;
  if (n === 1) return "1x";
  if (n === 8) return "8+";
  const sides = Array.isArray(boat.rigging)
    ? boat.rigging.map((r: BHCRecord) => String(r.seat_side).toLowerCase())
    : [];
  const rig = sides.length
    ? sides.every((s: string) => s === "sculling")
      ? "sculling"
      : sides.every((s: string) => ["port", "starboard"].includes(s))
        ? "sweep"
        : "unknown"
    : String(boat.rigging ?? boat.rigging_type ?? "").toLowerCase();
  const cox = String(boat.coxed ?? boat.coxswain ?? "").toLowerCase();
  if (rig.includes("scull")) return n === 2 ? "2x" : "4x";
  if (rig.includes("sweep") && ["yes", "no", "true", "false"].includes(cox))
    return `${n}${["yes", "true"].includes(cox) ? "+" : "−"}` as (typeof BOAT_CLASSES)[number];
  return null; // Unknown rigging must not silently become a sweep boat.
}
export function normalizePractice(
  meta: BHCRecord,
  detail: BHCRecord,
  custid: number,
  boats: BHCRecord[],
) {
  const own = (detail.attendance || []).find(
    (a: BHCRecord) => Number(a.custid) === custid,
  );
  const coaches = [
    ...new Map(
      (detail.assigned_coaches || [])
        .filter((c: BHCRecord) => c.custid || c.coach_custid)
        .map((c: BHCRecord) => [
          Number(c.custid || c.coach_custid),
          {
            id: Number(c.custid || c.coach_custid),
            name: String(c.fname || c.coach_fname || "").trim(),
          },
        ]),
    ).values(),
  ] as { id: number; name: string }[];
  const occupied = new Set(
    (detail.attendance || [])
      .map((a: BHCRecord) => Number(a.lineup_boat))
      .filter((n: number) => n > 0),
  );
  const planned_boats = [
    ...new Set(
      boats
        .filter((b) => occupied.has(Number(b.boat_id)))
        .map(bhcBoatClass)
        .filter(Boolean),
    ),
  ];
  const start = Number(meta.start_time);
  const end = Number(meta.end_time);
  if (!start || !end || end <= start)
    throw new Error("BHC practice has invalid times.");
  return {
    bhc_practice_id: Number(meta.practice_id),
    title: String(meta.name || "Practice").slice(0, 120),
    starts_at: new Date(start * 1000).toISOString(),
    ends_at: new Date(end * 1000).toISOString(),
    attendance: bhcAttendance(
      meta.current_attendance_status ??
        meta.attendance_plan ??
        own?.attendance_plan,
    ),
    deadline: meta.attendance_window_end
      ? new Date(Number(meta.attendance_window_end) * 1000).toISOString()
      : null,
    planned_boats,
    planned_coaches: coaches.map((c) => c.name).filter(Boolean),
    coaches,
    planned_boat: bhcBoatClass(
      boats.find((b) => Number(b.boat_id) === Number(own?.lineup_boat)),
    ),
    planned_seat: own?.lineup_seat ? String(own.lineup_seat) : null,
  };
}
export function syncTimes(
  p: { starts_at: string; ends_at: string; deadline: string | null },
  now = Date.now(),
) {
  return [
    p.deadline ? Date.parse(p.deadline) + 300000 : null,
    Date.parse(p.starts_at) - 3600000,
    Date.parse(p.ends_at) + 600000,
  ].filter((t): t is number => t !== null && t > now);
}
