import { expect, test } from "vitest";
import {
  scenarioAttendance,
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
    name: "Test practice",
    start_time: 1800000000,
    end_time: 1800003600,
    lineups_set: action === "reset" ? "No" : "Yes",
  };
  return normalizeLineup(
    meta,
    { lineups_set: meta.lineups_set, attendance },
    athlete,
    [
      {
        boat_id: 920000001,
        boat_name: "TEST · River",
        boat_type: 4,
        coxed: "Yes",
        rigging: "sweep",
      },
    ],
  );
}
test("crew-only changes preserve a previous seat move and its side", () => {
  const published = change("publish");
  const moved = change("seat", published);
  const before = JSON.stringify(moved);
  const crew = change("crew", moved);
  expect(ownSeat(moved)?.seat).toBe("2");
  expect(ownSeat(crew)).toEqual(ownSeat(moved));
  expect(lineupSignatures(crew).assignment).toBe(
    lineupSignatures(moved).assignment,
  );
  expect(lineupSignatures(crew).crew).not.toBe(lineupSignatures(moved).crew);
  expect(crew.boats[0].seats.find((p) => p.seat === "1")?.name).toBe(
    "Casey Test",
  );
  expect(JSON.stringify(moved)).toBe(before);
});
test("repeated edits toggle independently and removal preserves the remaining crew", () => {
  const moved = change("seat", change("publish"));
  const crew = change("crew", moved);
  const restoredCrew = change("crew", crew);
  expect(ownSeat(restoredCrew)).toEqual(ownSeat(moved));
  expect(restoredCrew.boats[0].seats.find((p) => p.seat === "1")?.name).toBe(
    "Taylor Test",
  );
  const restoredSeat = change("seat", crew);
  expect(ownSeat(restoredSeat)?.seat).toBe("3");
  expect(restoredSeat.boats[0].seats.find((p) => p.seat === "1")?.name).toBe(
    "Casey Test",
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
