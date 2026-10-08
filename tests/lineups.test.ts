import { expect, test } from "vitest";
import {
  normalizeLineup,
  lineupChange,
  lineupSignatures,
  lineupEmail,
  ownBoat,
} from "../shared/lineups";
const meta = {
  name: "Masters",
  start_time: 2000000000,
  end_time: 2000003600,
  lineups_set: "Yes",
};
const boat = { boat_id: 7, boat_name: "Pratt (155 - 185 lbs)", boat_type: 8 };
const athlete = (custid: number, seat: string, boat_id = 7) => ({
  custid,
  fname: "Rower",
  lname: String(custid),
  attendance_plan: "Attending",
  lineup_boat: boat_id,
  lineup_seat: seat,
  lineup_side: "Port",
  weight: 180,
  birth_year: 1950,
  email: "private@example.test",
});
const detail = {
  lineups_set: "Yes",
  attendance: [athlete(42, "3"), athlete(43, "8"), athlete(44, "coxswain")],
  assigned_coaches: [
    {
      boat_id: 7,
      coach_custid: 9,
      coach_fname: "Coach",
      coach_lname: "Person",
    },
  ],
};
const normalized = () => normalizeLineup(meta, detail, 42, [boat]);
test("drafts never expose crew and missing publication fields fail closed", () => {
  expect(
    normalizeLineup({ ...meta, lineups_set: "No" }, detail, 42, [boat]).boats,
  ).toEqual([]);
  expect(
    normalizeLineup(meta, { ...detail, lineups_set: "No" }, 42, [boat])
      .published,
  ).toBe(false);
  expect(() =>
    normalizeLineup(meta, { attendance: detail.attendance }, 42, [boat]),
  ).toThrow("Unverified");
  expect(() =>
    normalizeLineup({ ...meta, lineups_set: undefined }, detail, 42, [boat]),
  ).toThrow("Unverified");
});
test("crew is normalized, ordered and stripped of coaching-only and contact fields", () => {
  const result = normalized();
  expect(ownBoat(result)?.name).toBe("Pratt");
  expect(result.boats[0].seats.map((s) => s.seat)).toEqual([
    "coxswain",
    "8",
    "3",
  ]);
  expect(result.boats[0].coaches[0].name).toBe("Coach Person");
  expect(JSON.stringify(result)).not.toMatch(
    /weight|birth_year|private@example|185/,
  );
});
test("duplicates and ambiguous seats are rejected rather than announcing a false change", () => {
  expect(() =>
    normalizeLineup(
      meta,
      { ...detail, attendance: [athlete(42, "3"), athlete(43, "3")] },
      42,
      [boat],
    ),
  ).toThrow("Duplicate");
  expect(() =>
    normalizeLineup(
      meta,
      { ...detail, attendance: [athlete(42, "unknown")] },
      42,
      [boat],
    ),
  ).toThrow("Invalid");
});
test("signatures ignore array order, other boats and display-name corrections", () => {
  const first = normalized();
  const second = normalizeLineup(
    meta,
    {
      ...detail,
      attendance: [
        athlete(99, "1", 8),
        ...detail.attendance
          .slice()
          .reverse()
          .map((a) => ({ ...a, fname: "Corrected" })),
      ],
    },
    42,
    [boat, { boat_id: 8, boat_type: 1 }],
  );
  expect(lineupSignatures(first)).toEqual(lineupSignatures(second));
  second.boats
    .find((b) => b.boat_id === 7)!
    .seats.find((s) => s.athlete_id === 43)!.athlete_id = 45;
  expect(lineupSignatures(second).assignment).toBe(
    lineupSignatures(first).assignment,
  );
  expect(lineupSignatures(second).crew).not.toBe(lineupSignatures(first).crew);
});
test("seat moves, boat moves and removals have clear change summaries", () => {
  const before = normalized(),
    current = normalized();
  current.boats[0].seats.find((s) => s.athlete_id === 42)!.seat = "5";
  expect(lineupChange(before, current)).toContain("from 3 to 5");
  current.boats[0].boat_id = 8;
  current.boats[0].name = "Other";
  expect(lineupChange(before, current)).toContain("from Pratt to Other");
  current.boats = [];
  expect(lineupChange(before, current)).toContain("removed");
});
test("email includes full own crew, coach and escaped text, with direct practice links", () => {
  const lineup = normalized();
  lineup.title = "Masters & <script>alert(1)</script>";
  const email = lineupEmail(
    lineup,
    "Published",
    "https://mendocean.fyi/?tab=Lineups&lineup=123",
    "https://mendocean.fyi/?account=1",
  );
  expect(email.text).toContain("3 seat: Rower 42 (You)");
  expect(email.text).toContain("Cox: Rower 44");
  expect(email.text).toContain("Coach: Coach Person");
  expect(email.html).toContain("&lt;script&gt;");
  expect(email.html).not.toContain("<script>");
  expect(email.html).toContain("tab=Lineups&amp;lineup=123");
});

test("designed emails omit the boathouse and reminder, highlight the rower, and link only valid coach emails", () => {
  const lineup = normalized();
  lineup.location = "MRC Boathouse";
  lineup.boats[0].coaches[0].email = "coach@example.com";
  const email = lineupEmail(
    lineup,
    "Your crew has changed.",
    "https://mendocean.fyi/?tab=Lineups&lineup=123",
    "https://mendocean.fyi/?account=1",
  );
  expect(email.html).toContain("mailto:coach%40example.com?subject=");
  expect(email.html).toContain("lineup-oar-right.png");
  expect(email.html).toContain("YOU");
  expect(email.html).not.toMatch(/MRC Boathouse|when this email was generated/);
  expect(email.text).not.toContain("MRC Boathouse");
  expect(email.text).toContain("Coach: Coach Person <coach@example.com>");
  const publication = lineupEmail(
    lineup,
    "Published",
    "https://mendocean.fyi/",
    "https://mendocean.fyi/?account=1",
    "published",
  );
  expect(publication.html).toContain("Your crew is ready");
  lineup.boats = [];
  expect(
    lineupEmail(
      lineup,
      "Removed",
      "https://mendocean.fyi/",
      "https://mendocean.fyi/?account=1",
    ).html,
  ).toContain("No seat assigned");
});
