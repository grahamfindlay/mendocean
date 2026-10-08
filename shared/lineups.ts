import { bhcAttendance, bhcBoatClass, type BHCRecord } from "./bhc.ts";
import { formatDate, formatTime } from "./domain.ts";
import { boatSeatCount, coachMailto, oarSides } from "./lineup-display.ts";

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
  coaches: { athlete_id: number; name: string; email?: string }[];
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
    ? "Cox"
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
      ? `Lineup published: ${boat!.name} · ${seatLabel(seat.seat, Number(boat!.boat_class?.[0]) || 8)}.`
      : "Lineup published. You have not been assigned a seat yet.";
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
  kind: "published" | "changed" = "changed",
) {
  const boat = ownBoat(lineup),
    seat = ownSeat(lineup);
  const date = `${formatDate(lineup.starts_at)} · ${formatTime(lineup.starts_at)} – ${formatTime(lineup.ends_at)}`;
  const headline = kind === "published" ? "" : "Your lineup has changed";
  const lines = [
    headline,
    summary,
    `${lineup.title} · ${date}`,
    boat
      ? `${boat.name}${boat.boat_class ? ` · ${boat.boat_class}` : ""}`
      : "Awaiting a boat assignment",
  ];
  if (boat) {
    for (const s of boat.seats)
      lines.push(
        `${seatLabel(s.seat, boatSeatCount(boat))}: ${s.name}${s.athlete_id === lineup.athlete_id ? " (You)" : ""}${s.seat !== "coxswain" && s.side ? ` · ${s.side}` : ""}`,
      );
    for (const c of boat.coaches)
      lines.push(
        `Coach: ${c.name}${coachMailto(c.email, lineup) ? ` <${c.email}>` : ""}`,
      );
  }
  if (lineup.plan) lines.push(`Practice plan: ${lineup.plan}`);
  const origin = new URL(url).origin;
  const oar = (direction: "left" | "right", show: boolean) =>
    show
      ? `<img src="${escape(origin)}/lineup-oar-${direction}.png" width="24" height="17" alt="" style="display:inline-block;vertical-align:middle;border:0;width:24px;height:17px">`
      : "";
  const rows =
    boat?.seats
      .map((s) => {
        const you = s.athlete_id === lineup.athlete_id;
        const sides = oarSides(s);
        return `<tr style="background:${you ? "#e7efdf" : "#fffdf6"}">
      <td class="lineup-email-seat" width="140" style="padding:13px 20px 13px 12px;border-bottom:1px solid #e3e5da;color:${you ? "#244a2d" : "#61736c"};font-size:13px">
        <table class="lineup-email-oars" role="presentation" width="112" cellpadding="0" cellspacing="0" style="width:112px;table-layout:fixed"><tr>
          <td class="lineup-email-oar-cell" width="30" align="right">${oar("left", sides.left)}</td>
          <td class="lineup-email-label" width="52" align="center" style="white-space:nowrap;font-weight:${you ? "700" : "400"}">${escape(seatLabel(s.seat, boatSeatCount(boat!)))}</td>
          <td class="lineup-email-oar-cell" width="30" align="left">${oar("right", sides.right)}</td>
        </tr></table>
      </td>
      <td class="lineup-email-name"${you ? "" : ' colspan="2"'} style="padding:13px 8px;border-bottom:1px solid #e3e5da;font-size:15px;font-weight:${you ? "700" : "400"};overflow-wrap:anywhere">${escape(s.name)}</td>
      ${you ? '<td width="30" align="right" style="padding:13px 12px 13px 0;border-bottom:1px solid #e3e5da;font-size:11px;font-weight:700;color:#3b6a3f">YOU</td>' : ""}
    </tr>`;
      })
      .join("") ?? "";
  const coaches = boat?.coaches
    .map((c) => {
      const href = coachMailto(c.email, lineup);
      return href
        ? `<a href="${escape(href)}" style="color:#3b6a3f;text-decoration:underline">${escape(c.name)}</a>`
        : escape(c.name);
    })
    .join(", ");
  const boatHTML = boat
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffdf6;border:1px solid #d9ddd1;border-radius:14px">
    <tr><td colspan="3" style="padding:20px 16px 16px"><p style="margin:0 0 6px;color:#61736c;font-size:11px;letter-spacing:1.2px;font-weight:700">YOUR BOAT${seat ? ` · ${escape(seatLabel(seat.seat, boatSeatCount(boat))).toUpperCase()}` : ""}</p><h2 style="margin:0;font-size:23px;line-height:1.3;font-weight:700">${escape(boat.name)}${boat.boat_class ? ` <span style="font-size:14px;font-weight:400;color:#61736c">${escape(boat.boat_class)}</span>` : ""}</h2></td></tr>
    ${rows}
    ${coaches ? `<tr><td colspan="3" style="padding:16px;font-size:14px;color:#61736c">${boat.coaches.length > 1 ? "Coaches" : "Coach"} &nbsp;${coaches}</td></tr>` : ""}
    </table>`
    : `<p style="padding:18px;background:#fffdf6;border:1px solid #d9ddd1;border-radius:12px;font-size:15px;line-height:1.6">No seat assigned.</p>`;
  return {
    text:
      lines.filter(Boolean).join("\n") +
      `\n\nView lineup: ${url}\nManage lineup notifications: ${accountURL}`,
    html: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><style>
      @media(max-width:375px){.lineup-email-name{font-size:14px!important}}
      @media(max-width:360px){.lineup-email-seat{width:98px!important;padding-left:6px!important;padding-right:4px!important}.lineup-email-oars{width:88px!important}.lineup-email-oar-cell{width:24px!important}.lineup-email-label{width:40px!important}.lineup-email-name{font-size:13px!important}}
    </style></head><body style="margin:0;padding:0;background:#f8f5ec;color:#183f3a;font-family:Arial,Helvetica,sans-serif">
      <div style="display:none;max-height:0;overflow:hidden">${escape(`${summary} ${lineup.title} · ${date}`)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ec"><tr><td align="center" style="padding:28px 12px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td>
          <p style="margin:0 0 28px;font-size:20px;letter-spacing:-0.8px;font-weight:700;color:#3b6a3f">Mendocean</p>
          ${headline ? `<h1 style="margin:0 0 14px;font-size:30px;line-height:1.2;letter-spacing:-0.7px">${headline}</h1>` : ""}
          ${kind === "changed" ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6">${escape(summary)}</p>` : ""}
          <p style="margin:0 0 5px;font-size:17px;font-weight:700">${escape(lineup.title)}</p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#61736c">${escape(date)}</p>
          ${boatHTML}
          ${lineup.plan ? `<h2 style="margin:24px 0 8px;font-size:15px">Practice plan</h2><p style="margin:0;font-size:14px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere">${escape(lineup.plan)}</p>` : ""}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0"><tr><td bgcolor="#3b6a3f" style="border-radius:9px"><a href="${escape(url)}" style="display:inline-block;padding:15px 24px;font-size:15px;font-weight:700;color:#fffdf6;text-decoration:none">View lineup</a></td></tr></table>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#61736c"><a href="${escape(accountURL)}" style="color:#61736c">Manage lineup notifications</a></p>
        </td></tr></table>
      </td></tr></table></body></html>`,
  };
}
