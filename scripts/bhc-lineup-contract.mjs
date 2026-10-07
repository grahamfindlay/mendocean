// Deliberate, read-only check. Supply a dedicated member token in the environment.
// Output contains shape diagnostics only: no tokens, URLs, names or raw responses.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalizeLineup, lineupSignatures } from "../shared/lineups.ts";
const token = process.env.BHC_CONTRACT_TOKEN;
if (!token)
  throw new Error(
    "BHC_CONTRACT_TOKEN is required; never put credentials in command arguments",
  );
let requests = 0;
async function read(path, args = {}) {
  if (++requests > 6) throw new Error("Read budget exceeded");
  const url = new URL("https://api.boathouseconnect.com/" + path);
  url.searchParams.set("token", token);
  for (const [k, v] of Object.entries(args)) url.searchParams.set(k, String(v));
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch {
    throw new Error("BHC read failed; credentials and response withheld");
  }
}
const list = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  throw new Error("BHC list shape changed");
};
try {
  const auth = await read("authenticate/checkApiKey");
  if (!Number.isSafeInteger(Number(auth.custid)) || Number(auth.custid) <= 0)
    throw new Error("BHC identity could not be verified");
  const clubs = list(await read("users/getAllWhitelabels"));
  const club = Number(
    process.env.BHC_CONTRACT_CLUB_ID ||
      clubs.find((c) =>
        String(c.whitelabel_name ?? "")
          .toLowerCase()
          .includes("mendota"),
      )?.whitelabel_id,
  );
  if (!club || !clubs.some((c) => Number(c.whitelabel_id) === club))
    throw new Error("Specify a verified member club ID");
  const practices = list(
    await read("practices/getAthletePractices", {
      whitelabel_id: club,
      upcoming: process.env.BHC_CONTRACT_PAST !== "true",
    }),
  );
  const selected = process.env.BHC_CONTRACT_PRACTICE_ID;
  const meta = selected
    ? practices.find((p) => String(p.practice_id) === selected)
    : practices.find(
        (p) =>
          p.lineups_set === "Yes" &&
          String(p.current_attendance_status).toLowerCase() === "attending",
      );
  if (!meta)
    throw new Error(
      "No matching attended published practice available for verification",
    );
  const raw = await read("practices/getPractices", {
    whitelabel_id: club,
    practice_id: meta.practice_id,
    meta_only: "No",
    upcoming: false,
  });
  const detail = Array.isArray(raw) ? raw[0] : raw;
  const boats = list(
    await read("equipment/getAllBoats", { whitelabel_id: club }),
  );
  const lineup = normalizeLineup(meta, detail, Number(auth.custid), boats);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const signatures = lineupSignatures(lineup);
  const diagnostics = {
    practice: hash(String(meta.practice_id)),
    published: lineup.published,
    boat_count: lineup.boats.length,
    crew_count: lineup.boats.reduce((n, b) => n + b.seats.length, 0),
    assignment: hash(signatures.assignment),
    crew: hash(signatures.crew),
  };
  const path = process.env.BHC_CONTRACT_BASELINE;
  if (path) {
    let previous;
    try {
      previous = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("Invalid contract baseline");
    }
    if (previous?.practice === diagnostics.practice)
      console.log(
        JSON.stringify({
          publication_changed: previous.published !== diagnostics.published,
          assignment_changed: previous.assignment !== diagnostics.assignment,
          crew_changed: previous.crew !== diagnostics.crew,
        }),
      );
    writeFileSync(path, JSON.stringify(diagnostics), { mode: 0o600 });
  }
  console.log(JSON.stringify(diagnostics));
  console.log(
    "Member-token read contract passed. Coach draft/republish semantics still require observed before/after checks.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
