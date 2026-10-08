import { ownBoat, type Lineup } from "../../../shared/lineups.ts";

export const scenarios = [
  "reset",
  "publish",
  "seat",
  "crew",
  "remove",
  "refresh",
] as const;
export type Scenario = (typeof scenarios)[number];

export const scenarioBoats = [
  {
    boat_id: 920000001,
    boat_name: "River",
    boat_type: 4,
    coxed: "Yes",
    rigging: "sweep",
  },
  {
    boat_id: 920000002,
    boat_name: "Cedar",
    boat_type: 8,
    coxed: "Yes",
    rigging: "sweep",
  },
];
// Name-length check against the regular-member MRC directory, October 8, 2026.
// Synthetic IDs and assignments; this does not represent the member's real crew.
export const longRowerName = "Polyanna Nunes Da Silva";
const secondCrew = [
  [911000001, "Jamie Reed", "coxswain"],
  [911000002, "Riley Parker", "8"],
  [911000003, "Avery Quinn", "7"],
  [911000004, "Cameron Brooks", "6"],
  [911000005, "Robin Hayes", "5"],
  [911000006, "Drew Bennett", "4"],
  [911000007, "Harper Morgan", "3"],
  [911000008, "Sydney Lane", "2"],
  [911000009, "Blake Ellis", "1"],
] as const;

// Standard sweep rig: stroke/even seats port, odd seats starboard.
const sweepSide = (seat: string) =>
  seat === "coxswain" ? "" : Number(seat) % 2 ? "starboard" : "port";

export function scenarioAttendance(
  action: Scenario,
  athlete: number,
  previous: Lineup | null,
) {
  const base = [
    [910000001, "Alex Morgan", "coxswain"],
    [910000002, longRowerName, "4"],
    [910000003, "Morgan Chen", "2"],
    [910000004, "Taylor Brooks", "1"],
    [athlete, "Graham Findlay", "3"],
  ] as const;
  const editing =
    action !== "reset" &&
    action !== "publish" &&
    (action !== "refresh" || previous?.published);
  if (editing && !previous?.published)
    throw new Error("Publish a lineup before editing it.");
  const people = editing
    ? previous!.boats.flatMap((boat) =>
        boat.seats.map((seat) => ({
          custid: seat.athlete_id,
          fname:
            base.find(([id]) => id === seat.athlete_id)?.[1] ??
            (seat.athlete_id === 910000005 ? "Casey Bennett" : seat.name),
          lname: "",
          lineup_seat: seat.seat,
          lineup_side:
            action === "refresh" ? sweepSide(seat.seat) : seat.side || "",
          lineup_boat: boat.boat_id,
          attendance_plan: "Attending",
        })),
      )
    : base.map(([custid, fname, lineup_seat]) => ({
        custid,
        fname,
        lname: "",
        lineup_seat: String(lineup_seat),
        lineup_side: sweepSide(String(lineup_seat)),
        lineup_boat: 920000001,
        attendance_plan: "Attending",
      }));
  // Upgrade an existing saved fixture without resetting the owner's assignment.
  if (!people.some((p) => p.lineup_boat === 920000002)) {
    people.push(
      ...secondCrew.map(([custid, fname, lineup_seat]) => ({
        custid,
        fname,
        lname: "",
        lineup_seat,
        lineup_side: sweepSide(lineup_seat),
        lineup_boat: 920000002,
        attendance_plan: "Attending",
      })),
    );
  }
  const rower = people.find((p) => p.custid === athlete);
  if (action === "seat") {
    if (!rower) throw new Error("Publish a lineup to restore your seat first.");
    const target = rower.lineup_seat === "2" ? "3" : "2";
    const other = people.find(
      (p) => p.lineup_boat === rower.lineup_boat && p.lineup_seat === target,
    );
    if (other) {
      other.lineup_seat = rower.lineup_seat;
      other.lineup_side = rower.lineup_side;
    }
    rower.lineup_seat = target;
    rower.lineup_side = sweepSide(target);
  }
  if (action === "crew") {
    const boat = previous && ownBoat(previous);
    const other = people.find(
      (p) =>
        p.lineup_boat === boat?.boat_id &&
        p.custid !== athlete &&
        p.lineup_seat === "1",
    );
    if (!other) throw new Error("Publish a lineup to restore your crew first.");
    const useCasey = other.custid !== 910000005;
    other.custid = useCasey ? 910000005 : 910000004;
    other.fname = useCasey ? "Casey Bennett" : "Taylor Brooks";
  }
  if (action === "remove" && rower) rower.lineup_boat = 0;
  return people;
}
