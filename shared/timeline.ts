import {
  chicagoToISO,
  circularMean,
  localDateTime,
  windStatus,
  PRACTICE_WINDOWS,
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
/** Plotting context: retain surrounding samples to bracket the window. No extrapolation. */
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

/** Clip summary values to the same straight segments drawn by the chart. */
function boundedSummarySamples(
  samples: WeatherHour[],
  start: number,
  end: number,
) {
  const boundary = (time: number): WeatherHour | null => {
    const index = samples.findIndex((h) => stamp(h) >= time);
    const after = samples[index];
    if (!after) return null;
    if (stamp(after) === time) return after;
    const before = samples[index - 1];
    if (!before) return null;
    const gap = stamp(after) - stamp(before);
    if (gap > Math.max(sampleMinutes(before), sampleMinutes(after)) * 60000)
      return null;
    const fraction = (time - stamp(before)) / gap;
    const interpolate = (a: number | null, b: number | null) =>
      a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b)
        ? a + (b - a) * fraction
        : null;
    let direction: number | null = null;
    if (
      before.direction !== null &&
      after.direction !== null &&
      Number.isFinite(before.direction) &&
      Number.isFinite(after.direction)
    ) {
      const turn =
        ((((after.direction - before.direction + 540) % 360) + 360) % 360) -
        180;
      // Opposite bearings do not identify a unique direction of rotation.
      if (Math.abs(turn) !== 180)
        direction = (((before.direction + turn * fraction) % 360) + 360) % 360;
    }
    return {
      time: new Date(time).toISOString(),
      wind: interpolate(before.wind, after.wind),
      gust: interpolate(before.gust, after.gust),
      temperature: interpolate(before.temperature, after.temperature),
      direction,
      // Conditions are categorical; use the closer endpoint, never interpolate codes.
      code: fraction < 0.5 ? before.code : after.code,
      probability: null,
      precipitation: null,
      visibility: null,
    };
  };
  const clipped = samples.filter((h) => stamp(h) >= start && stamp(h) <= end);
  const first = boundary(start);
  const last = end === start ? null : boundary(end);
  if (first && (!clipped.length || stamp(clipped[0]) !== start))
    clipped.unshift(first);
  if (last && (!clipped.length || stamp(clipped.at(-1)!) !== end))
    clipped.push(last);
  return clipped;
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
/**
 * Each selected period on a Madison calendar day, summarized.
 *
 * Both boundaries are included, with estimates between actual samples,
 * but a window whose bounds fall outside the forecast horizon returns an
 * uncovered summary rather than being dropped, so a short provider response
 * shows as unknown instead of silently shortening the week.
 */
export function practiceWindows(
  weather: Forecast,
  day: string,
  periods: readonly {
    id: string;
    label: string;
    start: string;
    end: string;
  }[] = PRACTICE_WINDOWS,
) {
  return periods.map((window) => {
    let startsAt = NaN;
    let endsAt = NaN;
    try {
      startsAt = Date.parse(chicagoToISO(day + "T" + window.start));
      endsAt = Date.parse(chicagoToISO(day + "T" + window.end));
    } catch {
      /* Ambiguous/nonexistent DST bounds cannot define a precise window. */
      startsAt = NaN;
      endsAt = NaN;
    }
    return {
      ...window,
      startsAt,
      endsAt,
      summary: summarizeWindow(weather, startsAt, endsAt),
    };
  });
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
  /** In-window samples plus estimated boundary values. Zero means nothing is known. */
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
 * Summarize only the requested interval, estimating its boundaries when needed.
 *
 * Extremes and ranges only. A window can mix 15- and 60-minute samples, so an
 * unweighted mean would silently weight the near term four to one; a mean that
 * is wanted later must be time-weighted by `sampleMinutes`.
 * Outside samples supply boundary estimates, never their full extrema or status.
 * Figures are forecast estimates, not continuous bounds over actual conditions.
 */
export function summarizeWindow(
  weather: Forecast,
  start: number,
  end: number,
): WindowSummary {
  const context = windowSamples(weather, start, end);
  const samples = boundedSummarySamples(context.samples, start, end);
  const covered = context.covered;
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

/** Actual hourly probability intervals, clipped to the visible domain; gaps stay gaps. */
export function rainChanceIntervals(
  hours: WeatherHour[],
  start: number,
  end: number,
) {
  return hours
    .filter(
      (h) =>
        h.probability !== null &&
        Number.isFinite(h.probability) &&
        stamp(h) > start &&
        stamp(h) - 3600000 < end,
    )
    .map((h) => ({
      start: Math.max(start, stamp(h) - 3600000),
      end: Math.min(end, stamp(h)),
      probability: h.probability!,
    }));
}

/** Clock-aligned six-hour rulers, including on 23/25-hour Chicago calendar days. */
export function dayChartTicks(start: number, end: number) {
  const ticks: number[] = [];
  for (let t = Math.ceil(start / 3600000) * 3600000; t < end; t += 3600000) {
    if (
      Number(localDateTime(new Date(t).toISOString()).slice(11, 13)) % 6 ===
      0
    )
      ticks.push(t);
  }
  return ticks;
}
