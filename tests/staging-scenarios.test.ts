import { expect, test } from "vitest";
import {
  scenarioAttendance,
  scenarioBoats,
  longRowerName,
  type Scenario,
} from "../supabase/functions/staging-test/scenarios";
import {
  normalizeLineup,
  lineupSignatures,
  ownSeat,
  type Lineup,
} from "../shared/lineups";

const athlete = 900000002;
function change(action: Scenario, previous: Lineup | null = null) {
  const attendance = scenarioAttendance(action, athlete, previous);
  const meta = {
    name: "Masters Recreational",
    start_time: 1800000000,
    end_time: 1800003600,
    lineups_set:
      action === "reset" || (action === "refresh" && !previous?.published)
        ? "No"
        : "Yes",
  };
  return normalizeLineup(
    meta,
    { lineups_set: meta.lineups_set, attendance },
    athlete,
    scenarioBoats,
  );
}
test("crew-only changes preserve a previous seat move and its side", () => {
  const published = change("publish");
  expect(published.boats[0].seats.find((s) => s.seat === "4")?.side).toBe(
    "port",
  );
  expect(ownSeat(published)?.side).toBe("starboard");
  const moved = change("seat", published);
  const before = JSON.stringify(moved);
  const crew = change("crew", moved);
  expect(ownSeat(moved)?.seat).toBe("2");
  expect(ownSeat(moved)?.side).toBe("port");
  expect(ownSeat(crew)).toEqual(ownSeat(moved));
  expect(lineupSignatures(crew).assignment).toBe(
    lineupSignatures(moved).assignment,
  );
  expect(lineupSignatures(crew).crew).not.toBe(lineupSignatures(moved).crew);
  expect(crew.boats[0].seats.find((p) => p.seat === "1")?.name).toBe(
    "Casey Bennett",
  );
  expect(JSON.stringify(moved)).toBe(before);
});
test("repeated edits toggle independently and removal preserves the remaining crew", () => {
  const moved = change("seat", change("publish"));
  const crew = change("crew", moved);
  const restoredCrew = change("crew", crew);
  expect(ownSeat(restoredCrew)).toEqual(ownSeat(moved));
  expect(restoredCrew.boats[0].seats.find((p) => p.seat === "1")?.name).toBe(
    "Taylor Brooks",
  );
  const restoredSeat = change("seat", crew);
  expect(ownSeat(restoredSeat)?.seat).toBe("3");
  expect(restoredSeat.boats[0].seats.find((p) => p.seat === "1")?.name).toBe(
    "Casey Bennett",
  );
  const removed = change("remove", crew);
  expect(ownSeat(removed)).toBeUndefined();
  expect(removed.boats[0].seats).toEqual(
    crew.boats[0].seats.filter((p) => p.athlete_id !== athlete),
  );
});
test("edits require a published lineup and do not silently restore a removed rower", () => {
  expect(() => change("crew")).toThrow("Publish");
  expect(() => change("seat", change("reset"))).toThrow("Publish");
  const removed = change("remove", change("publish"));
  expect(() => change("seat", removed)).toThrow("restore your seat");
  expect(() => change("crew", removed)).toThrow("restore your crew");
});
test("presentation refresh preserves assignments, removals and unpublished state", () => {
  const moved = change("seat", change("publish"));
  expect(ownSeat(change("refresh", moved))).toEqual(ownSeat(moved));
  const removed = change("remove", moved);
  expect(ownSeat(change("refresh", removed))).toBeUndefined();
  expect(change("refresh", change("reset")).published).toBe(false);
});

test("presentation refresh adds the second boat and long name without moving the owner", () => {
  const moved = change("seat", change("publish"));
  const legacy = {
    ...moved,
    boats: moved.boats.filter((b) => b.boat_id === 920000001),
  };
  const refreshed = change("refresh", legacy);
  expect(ownSeat(refreshed)).toEqual(ownSeat(legacy));
  expect(refreshed.boats).toHaveLength(2);
  expect(refreshed.boats.find((b) => b.name === "Cedar")?.seats).toHaveLength(
    9,
  );
  expect(refreshed.boats[0].seats.some((s) => s.name === longRowerName)).toBe(
    true,
  );
});
