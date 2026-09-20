import { bhcAttendance } from "./bhc.ts";
import { timelineSamples } from "./timeline.ts";
import type { Forecast, Outing } from "./domain.ts";

export function outingPhase(
  o: Pick<Outing, "starts_at" | "ends_at">,
  now: number,
) {
  return now < Date.parse(o.starts_at)
    ? "future"
    : now < Date.parse(o.ends_at)
      ? "in_progress"
      : "past";
}
export function canLog(o: Pick<Outing, "starts_at">, now: number) {
  return Date.parse(o.starts_at) <= now;
}
export type RowTypeFilter = "All" | "Practices" | "Independent";
export type AttendanceFilter =
  "All" | "Attending" | "Unknown" | "Not attending";
export type ReportFilter = "All" | "Unlogged" | "Logged";
export interface RowFilters {
  type?: RowTypeFilter;
  attendance?: AttendanceFilter;
  reports?: ReportFilter;
  /** Past only: include practices the owner did not attend and never logged. */
  allPractices?: boolean;
}
const ATTENDANCE = {
  Attending: "attending",
  Unknown: "unknown",
  "Not attending": "declined",
} as const;
export function visibleOutings(
  outings: Outing[],
  view: "Upcoming" | "Past",
  now: number,
  {
    type = "All",
    attendance = "All",
    reports = "All",
    allPractices = false,
  }: RowFilters = {},
) {
  return outings
    .filter((o) => (outingPhase(o, now) === "past") === (view === "Past"))
    .filter((o) => {
      const practice = o.kind === "official";
      const logged = !!o.reports?.length;
      if (type !== "All" && practice !== (type === "Practices")) return false;
      if (reports !== "All" && logged !== (reports === "Logged")) return false;
      // Past's default set is a union: independent rows, practices the owner
      // attended, and anything already logged whatever BHC now says. That last
      // clause is the whole point -- attendance can change after the fact, and
      // without it a report the owner wrote would disappear from their own
      // history. Show all practices relaxes it for correcting old records.
      if (
        view === "Past" &&
        !allPractices &&
        practice &&
        !logged &&
        bhcAttendance(o.attendance) !== "attending"
      )
        return false;
      // Attendance describes practices only. An independent row carries no BHC
      // attendance, so an intersection here would hide every row the owner
      // scheduled themselves the moment they asked for the ones they are
      // attending. The type filter alone governs those.
      if (!practice || attendance === "All") return true;
      // Normalized rather than compared raw: the same function the importer
      // used, so a stored value it mapped to unknown filters as unknown.
      return bhcAttendance(o.attendance) === ATTENDANCE[attendance];
    })
    .sort(
      (a, b) =>
        (Date.parse(a.starts_at) - Date.parse(b.starts_at)) *
        (view === "Past" ? -1 : 1),
    );
}
export function forecastSamples(weather: Forecast, now: number) {
  const hours = timelineSamples(weather).sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time),
  );
  const candidates = [...(weather.current ? [weather.current] : []), ...hours]
    .filter((h) => Date.parse(h.time) <= now)
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const latest = candidates[0];
  return {
    current:
      latest && now - Date.parse(latest.time) < 3600000 ? latest : undefined,
    upcoming: hours.filter((h) => Date.parse(h.time) > now),
  };
}
export function weatherDescription(code: number | null) {
  if (code === null) return "Conditions unavailable";
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55].includes(code)) return "Drizzle";
  if ([56, 57].includes(code)) return "Freezing drizzle";
  if (code === 61) return "Light rain";
  if (code === 63) return "Moderate rain";
  if (code === 65) return "Heavy rain";
  if ([66, 67].includes(code)) return "Freezing rain";
  if ([71, 73, 75, 77].includes(code)) return "Snow";
  if ([80, 81, 82].includes(code)) return "Rain showers";
  if ([85, 86].includes(code)) return "Snow showers";
  if ([95, 96, 99].includes(code)) return "Thunderstorms";
  return "Conditions unavailable";
}

/** Forecast filters include independent rows in the owner's Attending category. */
export function scheduledAttendance(o: Pick<Outing, "kind" | "attendance">) {
  return o.kind === "independent" ? "attending" : bhcAttendance(o.attendance);
}
