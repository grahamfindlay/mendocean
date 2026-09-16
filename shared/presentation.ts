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
export function sortedOutings(
  outings: Outing[],
  view: "Upcoming" | "Past",
  now: number,
) {
  return outings
    .filter((o) => (outingPhase(o, now) === "past") === (view === "Past"))
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
  if ([61, 63, 65].includes(code)) return "Rain";
  if ([66, 67].includes(code)) return "Freezing rain";
  if ([71, 73, 75, 77].includes(code)) return "Snow";
  if ([80, 81, 82].includes(code)) return "Rain showers";
  if ([85, 86].includes(code)) return "Snow showers";
  if ([95, 96, 99].includes(code)) return "Thunderstorms";
  return "Conditions unavailable";
}
