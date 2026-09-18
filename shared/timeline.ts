import {
  chicagoToISO,
  localDateTime,
  type Forecast,
  type WeatherHour,
} from "./domain.ts";
const stamp = (h: WeatherHour) => Date.parse(h.time);
export const sampleMinutes = (h: WeatherHour) => h.interval_minutes || 60;
/** Prefer provider quarter-hour samples at duplicate instants. Never invent intermediate values. */
export function timelineSamples(weather: Forecast): WeatherHour[] {
  const byTime = new Map<number, WeatherHour>();
  for (const h of weather.hours)
    if (Number.isFinite(stamp(h))) byTime.set(stamp(h), h);
  for (const h of weather.quarter_hours || [])
    if (Number.isFinite(stamp(h)))
      byTime.set(stamp(h), { ...h, interval_minutes: 15 });
  return [...byTime.values()].sort((a, b) => stamp(a) - stamp(b));
}
export function nearTerm(weather: Forecast, now: number) {
  return summarySamples(timelineSamples(weather)).filter(
    (h) => stamp(h) > now && stamp(h) <= now + 6 * 3600000,
  );
}
/** Display selection only. Never thin the ingestion, archive or chart series. */
export function summarySamples(samples: WeatherHour[]) {
  return samples.filter(
    (h) =>
      sampleMinutes(h) === 60 || new Date(h.time).getUTCMinutes() % 30 === 0,
  );
}
/** Open-Meteo hourly probability applies to (end - 1 hour, end], not the next hour. */
export function hourlyRainChance(hours: WeatherHour[], time: string) {
  const t = Date.parse(time);
  const h = hours.find((h) => stamp(h) - 3600000 < t && t <= stamp(h));
  if (!h || h.probability === null || !Number.isFinite(h.probability))
    return null;
  return {
    probability: h.probability,
    start: stamp(h) - 3600000,
    end: stamp(h),
  };
}
/** Madison calendar days can contain 23 or 25 hours at DST changes. */
export function dayBounds(day: string): [number, number] {
  const next = new Date(Date.parse(day + "T12:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
  return [
    Date.parse(chicagoToISO(day + "T00:00")),
    Date.parse(chicagoToISO(next + "T00:00")),
  ];
}
/** Include actual boundary samples, with explicit partial-coverage status. No extrapolation. */
export function windowSamples(weather: Forecast, start: number, end: number) {
  const all = timelineSamples(weather);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return { samples: [] as WeatherHour[], covered: false };
  const before = all.filter((h) => stamp(h) <= start).at(-1);
  const after = all.find((h) => stamp(h) >= end);
  const samples = all.filter((h) => stamp(h) >= start && stamp(h) <= end);
  if (
    before &&
    stamp(before) < start &&
    start - stamp(before) <= sampleMinutes(before) * 60000
  )
    samples.unshift(before);
  if (
    after &&
    stamp(after) > end &&
    stamp(after) - end <= sampleMinutes(after) * 60000
  )
    samples.push(after);
  const covered =
    !!before &&
    !!after &&
    samples.length > 0 &&
    stamp(samples[0]) <= start &&
    stamp(samples.at(-1)!) >= end &&
    samples.every(
      (h, i) =>
        i === 0 ||
        stamp(h) - stamp(samples[i - 1]) <=
          Math.max(sampleMinutes(h), sampleMinutes(samples[i - 1])) * 60000,
    );
  return { samples, covered };
}
export function forecastDays(weather: Forecast, now: number) {
  const today = localDateTime(new Date(now).toISOString()).slice(0, 10);
  return [
    ...new Set(
      timelineSamples(weather).map((h) => localDateTime(h.time).slice(0, 10)),
    ),
  ]
    .filter((d) => d >= today)
    .slice(0, 7);
}
export function comparisonTimes(weather: Forecast, when: string, now: number) {
  return forecastDays(weather, now)
    .map((day) => {
      try {
        const time = chicagoToISO(day + "T" + when.slice(11));
        return {
          day,
          time,
          ...windowSamples(weather, Date.parse(time), Date.parse(time)),
        };
      } catch {
        return {
          day,
          time: null,
          samples: [] as WeatherHour[],
          covered: false,
        };
      }
    })
    .filter((d) => !d.time || Date.parse(d.time) >= now)
    .slice(0, 5);
}
/** A common axis for totals over different intervals: mean rate in inches/hour. */
export function precipitationRate(h: WeatherHour) {
  return h.precipitation === null
    ? null
    : (h.precipitation * 60) / sampleMinutes(h);
}
