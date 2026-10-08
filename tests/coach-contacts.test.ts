import { expect, test, vi } from "vitest";
import { coachContactLookup } from "../supabase/functions/_shared/coach-contacts";
import { contactEmail, coachMailto, oarSides } from "../shared/lineup-display";
import { lineupSignatures, type Lineup } from "../shared/lineups";
const lineup = (coach = 17622): Lineup => ({
  title: "Masters & Recreational",
  starts_at: "2026-10-10T12:30:00Z",
  ends_at: "2026-10-10T14:00:00Z",
  location: "MRC Boathouse",
  plan: "",
  published: true,
  athlete_id: 42,
  boats: [
    {
      boat_id: 1,
      name: "Pratt",
      boat_class: "8+",
      seats: [{ athlete_id: 42, name: "Rower", seat: "3", side: "port" }],
      coaches: [{ athlete_id: coach, name: "Coach" }],
    },
  ],
});
test("verified club addresses override BHC personal addresses only for MRC member IDs", async () => {
  const read = vi.fn(async () => [
    { custid: 17622, email: "personal@example.com" },
  ]);
  const mrc = lineup(),
    signatures = lineupSignatures(mrc);
  await coachContactLookup(2362, read)(mrc);
  expect(mrc.boats[0].coaches[0].email).toBe("tstulting@mendotarowingclub.com");
  expect(read).not.toHaveBeenCalled();
  expect(lineupSignatures(mrc)).toEqual(signatures);
  const other = lineup();
  await coachContactLookup(1, read)(other);
  expect(other.boats[0].coaches[0].email).toBe("personal@example.com");
});
test("directory lookup is reused per sync and saves only assigned coach addresses", async () => {
  const read = vi.fn(async () => [
    { custid: 90, email: "coach@example.com", phone: "private" },
    { custid: 91, email: "unrelated@example.com" },
  ]);
  const enrich = coachContactLookup(2362, read);
  const first = lineup(90),
    second = lineup(90);
  await enrich(first);
  await enrich(second);
  expect(read).toHaveBeenCalledTimes(1);
  expect(first.boats[0].coaches[0].email).toBe("coach@example.com");
  expect(JSON.stringify(first)).not.toMatch(/unrelated|phone|private/);
});
test("directory failures and unsafe email values leave names usable without links", async () => {
  const current = lineup(90);
  await coachContactLookup(2362, async () => {
    throw new Error("outage");
  })(current);
  expect(current.boats[0].coaches[0]).toEqual({
    athlete_id: 90,
    name: "Coach",
  });
  for (const value of [
    "coach@example.com\r\nBcc:someone@example.com",
    "mailto:coach@example.com",
    "Coach <coach@example.com>",
    "coach@example.com?body=hello",
    "",
  ]) {
    expect(contactEmail(value)).toBeUndefined();
    expect(coachMailto(value, current)).toBeUndefined();
  }
  const href = coachMailto("coach@example.com", current)!;
  expect(href).toMatch(/^mailto:coach%40example.com\?subject=/);
  expect(decodeURIComponent(href)).toContain("Masters & Recreational —");
});
test("oars use the rower's perspective and sculling/coxswain have appropriate treatment", () => {
  const seat = { athlete_id: 42, name: "Rower", seat: "3", side: "starboard" };
  expect(oarSides(seat)).toEqual({ left: true, right: false });
  expect(oarSides({ ...seat, side: "port" })).toEqual({
    left: false,
    right: true,
  });
  expect(oarSides({ ...seat, side: "sculling" })).toEqual({
    left: true,
    right: true,
  });
  expect(oarSides({ ...seat, seat: "coxswain" })).toEqual({
    left: false,
    right: false,
  });
  expect(oarSides({ ...seat, side: null })).toEqual({
    left: false,
    right: false,
  });
});
