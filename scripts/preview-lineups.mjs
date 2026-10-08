import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeLineup,
  lineupEmail,
  lineupChange,
} from "../shared/lineups.ts";
import {
  scenarioAttendance,
  scenarioBoats,
} from "../supabase/functions/staging-test/scenarios.ts";
import { localDateTime, chicagoToISO } from "../shared/domain.ts";
const output = resolve("test-results/lineup-design");
const origin = process.env.LINEUP_PREVIEW_ORIGIN || "http://127.0.0.1:4173";
mkdirSync(output, { recursive: true });
const athlete = 900000002;
const nextDate = localDateTime(
  new Date(Date.now() + 86400000).toISOString(),
).slice(0, 10);
const starts = Date.parse(chicagoToISO(nextDate + "T07:30")) / 1000;
const meta = {
  name: "Masters Recreational",
  start_time: starts,
  end_time: starts + 5400,
  lineups_set: "Yes",
};
function change(action, previous) {
  const lineup = normalizeLineup(
    meta,
    {
      lineups_set: "Yes",
      location: { name: "MRC Boathouse" },
      session_plan: {
        session_plan:
          "Warm up to the first buoy, then three 10-minute pieces at 18–20 strokes per minute. Easy row back.",
      },
      attendance: scenarioAttendance(action, athlete, previous),
      assigned_coaches: scenarioBoats.map((boat) => ({
        boat_id: boat.boat_id,
        custid: 930000001,
        fname: "Sam",
        lname: "Rivera",
      })),
    },
    athlete,
    scenarioBoats,
  );
  for (const boat of lineup.boats)
    for (const coach of boat.coaches) coach.email = "sam.rivera@example.com";
  return {
    ...lineup,
    outing_id: "preview-lineup",
    checked_at: new Date().toISOString(),
  };
}
const published = change("publish", null),
  moved = change("seat", published),
  crew = change("crew", moved),
  removed = change("remove", crew);
for (const [name, current, previous] of [
  ["published", published, null],
  ["seat-changed", moved, published],
  ["crew-changed", crew, moved],
  ["removed", removed, crew],
]) {
  const message = lineupEmail(
    current,
    lineupChange(previous, current),
    origin + "/?tab=Lineups&lineup=preview-lineup",
    origin + "/?account=1",
    name === "published" ? "published" : "changed",
  );
  writeFileSync(resolve(output, name + ".html"), message.html);
  writeFileSync(resolve(output, name + ".txt"), message.text);
}
writeFileSync(
  resolve(output, "lineup.json"),
  JSON.stringify(published, null, 2),
);
console.log("Saved four email variants and a fictional lineup in " + output);
