import {
  chicagoToISO,
  circularMean,
  localDateTime,
  windStatus,
  type Forecast,
  type WeatherHour,
  type WindStatus,
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
const RANK: Record<WindStatus, number> = {
  unavailable: -1,
  favorable: 0,
  caution: 1,
  unfavorable: 2,
};
/** Directions this scattered have no useful single bearing. R < 0.6 is roughly 55° of circular spread. */
const CONCENTRATED = 0.6;
function extremes(values: (number | null)[]) {
  const present = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  return present.length
    ? { min: Math.min(...present), max: Math.max(...present) }
    : null;
}
export interface WindowSummary {
  /** False when the interval is gapped, unbracketed or outside the horizon. */
  covered: boolean;
  /** How many provider samples the summary rests on. Zero means nothing is known. */
  samples: number;
  wind: { min: number; max: number } | null;
  gust: number | null;
  temperature: { min: number; max: number } | null;
  direction: { bearing: number | null; variable: boolean } | null;
  /** Worst applicable classification in the interval, not an average of them. */
  status: WindStatus;
  /** Range across the hours that carry one, never a whole-interval event probability. */
  probability: { min: number; max: number } | null;
  codes: number[];
}
/**
 * Summarize a requested interval from the samples that actually cover it.
 *
 * Extremes and ranges only. A window can mix 15- and 60-minute samples, so an
 * unweighted mean would silently weight the near term four to one; a mean that
 * is genuinely wanted later must be time-weighted by `sampleMinutes`. Every
 * figure is a sampled extreme, not a continuous bound over the interval.
 */
export function summarizeWindow(
  weather: Forecast,
  start: number,
  end: number,
): WindowSummary {
  const { samples, covered } = windowSamples(weather, start, end);
  const bearings = samples
    .map((h) => h.direction)
    .filter((d): d is number => d !== null && Number.isFinite(d));
  const resultant = bearings.length
    ? Math.hypot(
        bearings.reduce((sum, d) => sum + Math.cos((d * Math.PI) / 180), 0),
        bearings.reduce((sum, d) => sum + Math.sin((d * Math.PI) / 180), 0),
      ) / bearings.length
    : 0;
  const applicable = samples
    .map((h) => windStatus(h.wind, h.direction))
    .filter((s) => s !== "unavailable");
  return {
    covered,
    samples: samples.length,
    wind: extremes(samples.map((h) => h.wind)),
    gust: extremes(samples.map((h) => h.gust))?.max ?? null,
    temperature: extremes(samples.map((h) => h.temperature)),
    direction: bearings.length
      ? {
          bearing: circularMean(bearings),
          variable: resultant < CONCENTRATED,
        }
      : null,
    status: applicable.length
      ? applicable.reduce((worst, s) => (RANK[s] > RANK[worst] ? s : worst))
      : "unavailable",
    probability: extremes(
      // Quarter-hour samples carry no probability and mask the hourly value at
      // :00, so read the hourly series directly. An hour covers (t - 1h, t].
      weather.hours
        .filter((h) => stamp(h) >= start && stamp(h) - 3600000 < end)
        .map((h) => h.probability),
    ),
    codes: [
      ...new Set(
        samples.map((h) => h.code).filter((c): c is number => c !== null),
      ),
    ],
  };
}
