import { bhcAttendance, bhcBoatClass, type BHCRecord } from "./bhc.ts";
import { formatDate, formatTime } from "./domain.ts";

export interface LineupSeat {
  athlete_id: number;
  name: string;
  seat: string;
  side: string | null;
}
export interface LineupBoat {
  boat_id: number;
  name: string;
  boat_class: string | null;
  seats: LineupSeat[];
  coaches: { athlete_id: number; name: string }[];
}
export interface Lineup {
  outing_id?: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string;
  plan: string;
  published: boolean;
  athlete_id: number;
  boats: LineupBoat[];
  checked_at?: string;
  version?: number;
}
const id = (v: unknown) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error("Invalid lineup identifier");
  return n;
};
const text = (v: unknown, max = 120) =>
  String(v ?? "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, max);
const name = (v: BHCRecord) =>
  text(`${v.fname ?? v.coach_fname ?? ""} ${v.lname ?? v.coach_lname ?? ""}`) ||
  "Unnamed athlete";
export const seatOrder = (seat: string) =>
  seat === "coxswain" ? 100 : Number(seat);
export function seatLabel(seat: string, seats = 8) {
  return seat === "coxswain"
    ? "Coxswain"
    : seat === "1"
      ? "Bow"
      : Number(seat) === seats
        ? "Stroke"
        : `${seat} seat`;
}
export const ownBoat = (lineup: Lineup) =>
  lineup.boats.find((b) =>
    b.seats.some((s) => s.athlete_id === lineup.athlete_id),
  );
export const ownSeat = (lineup: Lineup) =>
  ownBoat(lineup)?.seats.find((s) => s.athlete_id === lineup.athlete_id);

// Project only attendee-facing data; never persist raw provider payloads or drafts.
export function normalizeLineup(
  meta: BHCRecord,
  detail: BHCRecord | null,
  athlete: number,
  equipment: BHCRecord[],
): Lineup {
  const start = Number(meta.start_time),
    end = Number(meta.end_time);
  if (!start || !end || end <= start)
    throw new Error("Invalid lineup practice times");
  const result: Lineup = {
    title: text(meta.name) || "Practice",
    starts_at: new Date(start * 1000).toISOString(),
    ends_at: new Date(end * 1000).toISOString(),
    location: text(detail?.location?.name ?? meta.location_name),
    plan: "",
    published: false,
    athlete_id: id(athlete),
    boats: [],
  };
  if (!["Yes", "No"].includes(meta.lineups_set))
    throw new Error("Unverified lineup publication state");
  if (meta.lineups_set !== "Yes") return result;
  if (
    !detail ||
    !["Yes", "No"].includes(detail.lineups_set) ||
    !Array.isArray(detail.attendance)
  )
    throw new Error("Unverified published lineup response");
  if (detail.lineups_set !== "Yes") return result;
  result.published = true;
  result.plan = text(detail.session_plan?.session_plan, 2000);
  const seen = new Set<number>();
  const boats = new Map<number, LineupBoat>();
  for (const a of detail.attendance) {
    if (!a.lineup_boat || bhcAttendance(a.attendance_plan) !== "attending")
      continue;
    const athlete_id = id(a.custid),
      boat_id = id(a.lineup_boat);
    let seat = String(a.lineup_seat ?? "")
      .toLowerCase()
      .trim();
    if (!/^(coxswain|[1-8])$/.test(seat) || seen.has(athlete_id))
      throw new Error("Invalid lineup assignment");
    seen.add(athlete_id);
    let boat = boats.get(boat_id);
    if (!boat) {
      const e = equipment.find((b) => Number(b.boat_id) === boat_id);
      boat = {
        boat_id,
        name:
          text(e?.boat_name ?? e?.name).replace(
            /\s*\(\d+\s*[-–]\s*\d+\s*lbs\)\s*$/i,
            "",
          ) || "Unnamed boat",
        boat_class: bhcBoatClass(e),
        seats: [],
        coaches: [],
      };
      boats.set(boat_id, boat);
    }
    if (boat.seats.some((s) => s.seat === seat))
      throw new Error("Duplicate lineup seat");
    const side = text(a.lineup_side).toLowerCase();
    boat.seats.push({
      athlete_id,
      name: name(a),
      seat,
      side: ["port", "starboard", "sculling"].includes(side) ? side : null,
    });
  }
  if (
    detail.assigned_coaches != null &&
    !Array.isArray(detail.assigned_coaches)
  )
    throw new Error("Invalid lineup coaches");
  for (const c of detail.assigned_coaches ?? []) {
    const boat = boats.get(Number(c.boat_id));
    if (!boat) continue;
    const athlete_id = id(c.coach_custid ?? c.custid);
    if (!boat.coaches.some((x) => x.athlete_id === athlete_id))
      boat.coaches.push({ athlete_id, name: name(c) });
  }
  result.boats = [...boats.values()].sort((a, b) => a.boat_id - b.boat_id);
  for (const b of result.boats) {
    b.seats.sort((a, b) => seatOrder(b.seat) - seatOrder(a.seat));
    b.coaches.sort((a, b) => a.athlete_id - b.athlete_id);
  }
  return result;
}
export function lineupSignatures(lineup: Lineup) {
  const boat = ownBoat(lineup),
    seat = ownSeat(lineup);
  const assignment = JSON.stringify([
    boat?.boat_id ?? null,
    seat?.seat ?? null,
    seat?.side ?? null,
  ]);
  return {
    assignment,
    crew: JSON.stringify([
      assignment,
      boat?.seats.map((s) => [s.athlete_id, s.seat, s.side]),
      boat?.coaches.map((c) => c.athlete_id),
      lineup.title,
      lineup.starts_at,
      lineup.ends_at,
      lineup.location,
      lineup.plan,
    ]),
  };
}
export function lineupChange(previous: Lineup | null, current: Lineup): string {
  if (!current.published) return "Lineups have been withdrawn.";
  const boat = ownBoat(current),
    seat = ownSeat(current);
  if (!previous?.published)
    return seat
      ? `Your lineup is published: ${boat!.name} · ${seatLabel(seat.seat, Number(boat!.boat_class?.[0]) || 8)}.`
      : "Lineups are published. You have not been assigned a seat yet.";
  const beforeBoat = ownBoat(previous),
    beforeSeat = ownSeat(previous);
  if (!seat && beforeSeat)
    return "Your boat assignment has been removed. Check with your coach.";
  if (seat && !beforeSeat)
    return `You are now assigned to ${boat!.name} · ${seatLabel(seat.seat, Number(boat!.boat_class?.[0]) || 8)}.`;
  if (beforeBoat?.boat_id !== boat?.boat_id)
    return `Your boat changed from ${beforeBoat?.name} to ${boat?.name}.`;
  if (beforeSeat?.seat !== seat?.seat)
    return `Your seat changed from ${beforeSeat?.seat} to ${seat?.seat} in ${boat?.name}.`;
  if (beforeSeat?.side !== seat?.side)
    return `Your rowing side changed to ${seat?.side ?? "unspecified"}.`;
  return "Your crew or practice details have changed.";
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function lineupEmail(
  lineup: Lineup,
  summary: string,
  url: string,
  accountURL: string,
) {
  const boat = ownBoat(lineup);
  const lines = [
    summary,
    `${lineup.title} · ${formatDate(lineup.starts_at)}, ${formatTime(lineup.starts_at)}`,
    lineup.location,
    boat
      ? `${boat.name}${boat.boat_class ? ` · ${boat.boat_class}` : ""}`
      : "Awaiting a boat assignment",
  ];
  if (boat) {
    const seats =
      Number(boat.boat_class?.[0]) ||
      Math.max(...boat.seats.map((s) => Number(s.seat) || 0));
    for (const s of boat.seats)
      lines.push(
        `${seatLabel(s.seat, seats)}: ${s.name}${s.athlete_id === lineup.athlete_id ? " (You)" : ""}${s.side ? ` · ${s.side}` : ""}`,
      );
    for (const c of boat.coaches) lines.push(`Coach: ${c.name}`);
  }
  if (lineup.plan) lines.push(`Practice plan: ${lineup.plan}`);
  return {
    text:
      lines.filter(Boolean).join("\n") +
      `\n\nView all boats: ${url}\nManage lineup notifications: ${accountURL}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:600px">${lines
      .filter(Boolean)
      .map((l) => `<p>${escape(l)}</p>`)
      .join(
        "",
      )}<p><a href="${escape(url)}">View full lineup in Mendocean</a></p><p>This is the lineup when this email was generated. Open Mendocean for updates.</p><p><a href="${escape(accountURL)}">Manage lineup notifications</a></p></div>`,
  };
}
