import { bhcAttendance, type BHCRecord } from "./bhc.ts";

export interface Attendee {
  id: number;
  name: string;
}

export interface AttendanceRoster {
  attendees: Attendee[];
  checked_at: string;
}

// Signup attendance is independent of lineup publication and boat assignment.
// Project names only; never expose provider contacts, surveys, or draft seats.
export function normalizeAttendanceRoster(
  detail: BHCRecord,
  viewer: number,
): Attendee[] {
  if (!Array.isArray(detail?.attendance))
    throw new Error("BHC attendance list is unavailable.");
  const attendees = new Map<number, Attendee>();
  for (const person of detail.attendance) {
    if (!person || typeof person !== "object" || Array.isArray(person))
      throw new Error("BHC attendance list is unavailable.");
    if (bhcAttendance(person.attendance_plan) !== "attending") continue;
    const id = Number(person.custid);
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new Error("BHC attendance list is unavailable.");
    if (id === viewer || attendees.has(id)) continue;
    const name = [person.fname, person.lname]
      .filter((part): part is string => typeof part === "string")
      .join(" ")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    attendees.set(id, { id, name: name || "Unnamed rower" });
  }
  return [...attendees.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
      a.id - b.id,
  );
}
