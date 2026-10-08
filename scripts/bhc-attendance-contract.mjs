// Deliberate read-only member-token check. Print only counts, never names,
// provider payloads, IDs, credential-bearing URLs, or token values.
import { bhcAttendance } from "../shared/bhc.ts";
import { normalizeAttendanceRoster } from "../shared/attendanceRoster.ts";
const token = process.env.BHC_CONTRACT_TOKEN;
if (!token)
  throw new Error(
    "Supply BHC_CONTRACT_TOKEN in the environment, never in command arguments.",
  );
let requests = 0;
async function read(path, args = {}) {
  if (++requests > 6) throw new Error("Read budget exceeded");
  const url = new URL("https://api.boathouseconnect.com/" + path);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(args))
    url.searchParams.set(key, String(value));
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch {
    throw new Error("BHC read failed; credentials and response withheld.");
  }
}
const list = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  throw new Error("Unexpected BHC list response.");
};
try {
  const auth = await read("authenticate/checkApiKey");
  const viewer = Number(auth.custid);
  if (!Number.isSafeInteger(viewer) || viewer <= 0)
    throw new Error("BHC identity could not be verified.");
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
    throw new Error("Verified member club required.");
  const args = { whitelabel_id: club, custid: viewer, upcoming: true };
  const practices = list(await read("practices/getAthletePractices", args));
  const selected = [];
  for (const match of [
    (p) => p.lineups_set === "No",
    (p) => bhcAttendance(p.current_attendance_status) === "declined",
    (p) => bhcAttendance(p.current_attendance_status) === "unknown",
  ]) {
    const practice = practices.find((p) => !selected.includes(p) && match(p));
    if (practice) selected.push(practice);
  }
  if (!selected.length && practices.length) selected.push(practices[0]);
  for (const practice of selected) {
    const raw = await read("practices/getPractices", {
      ...args,
      practice_id: practice.practice_id,
      meta_only: "No",
    });
    const detail = Array.isArray(raw) ? raw[0] : raw;
    const attendees = normalizeAttendanceRoster(detail, viewer);
    console.log(
      JSON.stringify({
        viewer_status: bhcAttendance(practice.current_attendance_status),
        published: practice.lineups_set === "Yes",
        other_attendees: attendees.length,
        unassigned_attendees: detail.attendance.filter(
          (p) =>
            Number(p.custid) !== viewer &&
            bhcAttendance(p.attendance_plan) === "attending" &&
            !p.lineup_boat,
        ).length,
      }),
    );
  }
  console.log(
    JSON.stringify({
      checked_practices: selected.length,
      requests,
      attendance_writes: 0,
    }),
  );
  if (!selected.length)
    throw new Error("No upcoming practices available for roster verification.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
