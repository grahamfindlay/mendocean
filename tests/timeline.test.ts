import { expect, test } from "vitest";
import { normalizeWeather, weatherURL } from "../shared/weather";
import {
  practiceWindows,
  rainChanceIntervals,
  dayChartTicks,
  nearTerm,
  precipitationRate,
  timelineSamples,
  windowSamples,
  summarySamples,
  hourlyRainChance,
  dayBounds,
  summarizeWindow,
} from "../shared/timeline";
import { forecastSamples } from "../shared/presentation";
import {
  chicagoToISO,
  directionLabel,
  localDateTime,
  type Forecast,
  type WeatherHour,
} from "../shared/domain";
const now = Date.parse("2026-09-15T14:24:00Z");
const row = (time: number, interval: 15 | 60 = 60): WeatherHour => ({
  time: new Date(time).toISOString(),
  interval_minutes: interval,
  wind: 7,
  gust: 12,
  direction: 350,
  temperature: 65,
  precipitation: 0.1,
  probability: interval === 60 ? 30 : null,
  code: 2,
  visibility: null,
});
const base = Date.parse("2026-09-15T14:00:00Z");
const weather: Forecast = {
  fetched_at: new Date(now).toISOString(),
  provider: "fixture",
  source_kind: "fixture",
  model_version: "hannah",
  current: null,
  hours: Array.from({ length: 144 }, (_, i) => row(base + i * 3600000)),
  quarter_hours: Array.from({ length: 17 }, (_, i) =>
    row(base + i * 900000, 15),
  ),
};
test("requests bounded quarter-hour data without fabricating rain probability", () => {
  const url = new URL(weatherURL());
  expect(url.searchParams.get("forecast_minutely_15")).toBe("192");
  expect(url.searchParams.get("minutely_15")).not.toContain("probability");
  const raw = {
    hourly: { time: [base / 1000], wind_speed_10m: [7] },
    minutely_15: {
      time: [base / 1000],
      wind_speed_10m: [null],
      precipitation: [0.1],
    },
  };
  const f = normalizeWeather(raw);
  expect(f.quarter_hours?.[0]).toMatchObject({
    wind: null,
    precipitation: 0.1,
    probability: null,
    interval_minutes: 15,
  });
  expect(f.hours[0].interval_minutes).toBe(60);
  expect(normalizeWeather({ hourly: raw.hourly }).quarter_hours).toEqual([]);
});
test("Now retains quarter hours while summaries step from 9:24 to 9:30 in half hours", () => {
  expect(forecastSamples(weather, now).current?.time).toBe(
    "2026-09-15T14:15:00.000Z",
  );
  const samples = nearTerm(weather, now);
  expect(samples[0].time).toBe("2026-09-15T14:30:00.000Z");
  expect(samples.slice(0, 8).map((h) => Date.parse(h.time))).toEqual(
    Array.from({ length: 8 }, (_, i) => base + (i + 1) * 1800000),
  );
  expect(
    samples.slice(8).every((h) => new Date(h.time).getUTCMinutes() === 0),
  ).toBe(true);
  expect(new Set(timelineSamples(weather).map((h) => h.time)).size).toBe(
    timelineSamples(weather).length,
  );
});
test("summary density never thins chart data or creates points in an hourly cache", () => {
  const raw = timelineSamples(weather);
  expect(raw.some((h) => new Date(h.time).getUTCMinutes() === 15)).toBe(true);
  expect(
    summarySamples(raw).every(
      (h) => new Date(h.time).getUTCMinutes() % 30 === 0,
    ),
  ).toBe(true);
  expect(weather.quarter_hours).toHaveLength(17);
  const hourly = timelineSamples({ ...weather, quarter_hours: [] });
  expect(summarySamples(hourly)).toEqual(hourly);
});
test("rain probability retains its preceding-hour bounds, zero and missing values", () => {
  const hours = [
    row(base),
    { ...row(base + 3600000), probability: 0 },
    { ...row(base + 7200000), probability: null },
  ];
  expect(
    hourlyRainChance(hours, new Date(base).toISOString())?.probability,
  ).toBe(30);
  for (const offset of [1, 15 * 60000, 30 * 60000, 3600000]) {
    expect(
      hourlyRainChance(hours, new Date(base + offset).toISOString()),
    ).toEqual({ probability: 0, start: base, end: base + 3600000 });
  }
  expect(
    hourlyRainChance(hours, new Date(base + 3600001).toISOString()),
  ).toBeNull();
  expect(
    hourlyRainChance(
      [hours[0], hours[2]],
      new Date(base + 1800000).toISOString(),
    ),
  ).toBeNull();
  expect(
    hourlyRainChance(hours, new Date(base - 3600000).toISOString()),
  ).toBeNull();
});
test("daily chart bounds follow Madison midnight across both DST transitions", () => {
  for (const [day, hours] of [
    ["2026-03-08", 23],
    ["2026-11-01", 25],
    ["2026-09-17", 24],
  ] as const) {
    const [start, end] = dayBounds(day);
    expect((end - start) / 3600000).toBe(hours);
    expect(localDateTime(new Date(start).toISOString())).toBe(day + "T00:00");
    expect(localDateTime(new Date(end).toISOString()).endsWith("T00:00")).toBe(
      true,
    );
  }
});
test("arbitrary minute and full window include both actual boundaries; no extrapolation", () => {
  const w = windowSamples(weather, now, now + 90 * 60000);
  expect(w.covered).toBe(true);
  expect(w.samples[0].time).toBe("2026-09-15T14:15:00.000Z");
  expect(w.samples.at(-1)?.time).toBe("2026-09-15T16:00:00.000Z");
  const point = windowSamples(weather, now, now);
  expect(point.samples).toHaveLength(2);
  expect(windowSamples(weather, base, base).samples).toHaveLength(1);
  expect(windowSamples(weather, base - 60000, base + 60000).covered).toBe(
    false,
  );
  expect(
    windowSamples(weather, base - 7200000, base - 3600000).samples,
  ).toEqual([]);
  const gap = {
    ...weather,
    hours: [],
    quarter_hours: weather.quarter_hours?.filter((_, i) => i !== 3),
  };
  expect(windowSamples(gap, now, now + 90 * 60000).covered).toBe(false);
});
test("old hourly cache brackets a minute-specific selection and labels its rain interval", () => {
  const old = { ...weather, quarter_hours: undefined };
  const p = windowSamples(old, now, now);
  expect(p.covered).toBe(true);
  expect(p.samples.map((h) => h.interval_minutes)).toEqual([60, 60]);
  expect(precipitationRate(row(base, 15))).toBe(0.4);
  expect(precipitationRate(row(base, 60))).toBe(0.1);
  expect(precipitationRate({ ...row(base), precipitation: null })).toBeNull();
  expect(precipitationRate({ ...row(base), precipitation: 0 })).toBe(0);
});
test("practice windows summarize the two rowing intervals and stay honest outside the horizon", () => {
  const windows = practiceWindows(weather, "2026-09-16");
  expect(windows.map((w) => w.id)).toEqual(["morning", "evening"]);
  // 05:30 CDT is 10:30Z; the fixture starts at 14:00Z on the 15th, so the
  // 16th is fully inside the horizon while the 15th's morning is not.
  expect(localDateTime(new Date(windows[0].startsAt).toISOString())).toBe(
    "2026-09-16T05:30",
  );
  expect(localDateTime(new Date(windows[0].endsAt).toISOString())).toBe(
    "2026-09-16T07:00",
  );
  expect(windows[0].summary.covered).toBe(true);
  expect(windows[0].summary.wind).toEqual({ min: 7, max: 7 });
  expect(windows[0].summary.gust).toBe(12);
  expect(windows[0].summary.temperature).toEqual({ min: 65, max: 65 });
  expect(windows[0].summary.status).toBe("unfavorable");
  const past = practiceWindows(weather, "2026-09-15");
  expect(past[0].summary.covered).toBe(false);
  expect(past[0].summary.samples).toBe(0);
  expect(past[0].summary.wind).toBeNull();
  expect(past[0].summary.status).toBe("unavailable");
  // Evening on the 15th runs 22:45Z to 00:15Z and is covered even though the
  // interval crosses midnight UTC.
  expect(past[1].summary.covered).toBe(true);
  // A day past the provider's horizon reports nothing rather than borrowing
  // the nearest sample.
  expect(practiceWindows(weather, "2026-10-01")[0].summary.samples).toBe(0);
});
test("windows spanning local midnight keep their trailing samples", () => {
  const midnight = chicagoToISO("2026-09-15T23:45");
  const window = windowSamples(
    weather,
    Date.parse(midnight),
    Date.parse(midnight) + 90 * 60000,
  );
  expect(window.covered).toBe(true);
  expect(
    localDateTime(window.samples.at(-1)!.time).startsWith("2026-09-16"),
  ).toBe(true);
});

const sample = (
  time: number,
  over: Partial<WeatherHour> = {},
  interval: 15 | 60 = 60,
): WeatherHour => ({ ...row(time, interval), ...over });
const windowOf = (
  hours: WeatherHour[],
  quarter: WeatherHour[] = [],
): Forecast => ({
  ...weather,
  hours,
  quarter_hours: quarter,
});
test("hourly session summaries clip outside peaks and classify only in-window conditions", () => {
  const startOfDay = Date.parse(chicagoToISO("2026-10-08T17:00"));
  const readings = [
    { wind: 6, gust: 9, direction: 275, temperature: 64, code: 95 },
    { wind: 4, gust: 4, direction: 247, temperature: 60, code: 3 },
    { wind: 5, gust: 5, direction: 234, temperature: 56, code: 3 },
    { wind: 5, gust: 5, direction: 229, temperature: 55, code: 95 },
  ];
  const forecast = windowOf(
    readings.map((h, i) => sample(startOfDay + i * 3600000, h)),
  );
  const start = startOfDay + 45 * 60000;
  const end = startOfDay + 135 * 60000;
  const original = structuredClone(forecast);
  const s = summarizeWindow(forecast, start, end);
  expect(s.covered).toBe(true);
  expect(s.samples).toBe(4);
  expect(s.wind).toEqual({ min: 4, max: 5 });
  expect(s.gust).toBe(5.25);
  expect(Math.round(s.gust!)).toBe(5);
  expect(s.temperature).toEqual({ min: 55.75, max: 61 });
  expect(s.status).toBe("favorable");
  expect(directionLabel(s.direction!.bearing)).toBe("WSW");
  expect(s.codes).toEqual([3]);
  // The chart still receives the actual outside samples, including the G9 peak.
  expect(windowSamples(forecast, start, end).samples).toEqual(forecast.hours);
  expect(forecast).toEqual(original);
});
test("short windows and point summaries interpolate both boundaries within one hour", () => {
  const forecast = windowOf([
    sample(base, { wind: 2, gust: 4, temperature: 50, direction: 180 }),
    sample(base + 3600000, {
      wind: 10,
      gust: 20,
      temperature: 70,
      direction: 180,
    }),
  ]);
  const s = summarizeWindow(forecast, base + 15 * 60000, base + 45 * 60000);
  expect(s.covered).toBe(true);
  expect(s.samples).toBe(2);
  expect(s.wind).toEqual({ min: 4, max: 8 });
  expect(s.gust).toBe(16);
  expect(s.temperature).toEqual({ min: 55, max: 65 });
  expect(s.status).toBe("favorable");
  const point = summarizeWindow(forecast, base + 30 * 60000, base + 30 * 60000);
  expect(point.covered).toBe(true);
  expect(point.samples).toBe(1);
  expect(point.wind).toEqual({ min: 6, max: 6 });
  expect(point.gust).toBe(12);
});
test("quarter-hour session boundaries keep actual values and interior gust peaks", () => {
  const quarter = Array.from({ length: 9 }, (_, i) =>
    sample(
      base + i * 900000,
      {
        wind: i === 0 || i === 8 ? 20 : 4,
        gust: i === 0 || i === 8 ? 30 : i === 4 ? 7 : 4,
        direction: 230,
        temperature: i === 0 || i === 8 ? 80 : 60,
      },
      15,
    ),
  );
  const forecast = windowOf([sample(base + 3600000, { gust: 99 })], quarter);
  const s = summarizeWindow(forecast, base + 15 * 60000, base + 105 * 60000);
  expect(s.covered).toBe(true);
  expect(s.samples).toBe(7);
  expect(s.wind).toEqual({ min: 4, max: 4 });
  expect(s.gust).toBe(7);
  expect(s.temperature).toEqual({ min: 60, max: 60 });
  expect(s.status).toBe("favorable");
});
test("boundary estimates use adjacent samples across the quarter-hour to hourly transition", () => {
  const forecast = windowOf(
    [sample(base + 3600000, { wind: 10, gust: 16, direction: 230 })],
    [sample(base + 45 * 60000, { wind: 4, gust: 4, direction: 230 }, 15)],
  );
  const s = summarizeWindow(forecast, base + 50 * 60000, base + 55 * 60000);
  expect(s.covered).toBe(true);
  expect(s.samples).toBe(2);
  expect(s.wind).toEqual({ min: 6, max: 8 });
  expect(s.gust).toBe(12);
  expect(s.status).toBe("favorable");
});
test("boundary directions interpolate along the shortest turn across north", () => {
  for (const directions of [
    [350, 10],
    [10, 350],
    [710, -350],
  ]) {
    const forecast = windowOf(
      directions.map((direction, i) =>
        sample(base + i * 3600000, { direction, wind: 4 }),
      ),
    );
    const point = summarizeWindow(
      forecast,
      base + 30 * 60000,
      base + 30 * 60000,
    );
    expect(point.direction!.bearing).toBeCloseTo(0);
    expect(point.status).toBe("favorable");
  }
  const opposite = windowOf([
    sample(base, { direction: 90 }),
    sample(base + 3600000, { direction: 270 }),
  ]);
  expect(
    summarizeWindow(opposite, base + 30 * 60000, base + 30 * 60000).direction,
  ).toBeNull();
});
test("summary boundaries do not bridge missing intervals or extrapolate past the horizon", () => {
  const forecast = windowOf(
    [],
    [sample(base, {}, 15), sample(base + 30 * 60000, {}, 15)],
  );
  const gap = summarizeWindow(forecast, base + 10 * 60000, base + 20 * 60000);
  expect(gap.covered).toBe(false);
  expect(gap.samples).toBe(0);
  expect(gap.wind).toBeNull();
  expect(gap.gust).toBeNull();
  expect(gap.status).toBe("unavailable");
  const hourly = windowOf([sample(base), sample(base + 3600000)]);
  const outside = summarizeWindow(hourly, base - 30 * 60000, base - 15 * 60000);
  expect(outside.covered).toBe(false);
  expect(outside.samples).toBe(0);
  const partial = summarizeWindow(hourly, base - 30 * 60000, base + 30 * 60000);
  expect(partial.covered).toBe(false);
  expect(partial.samples).toBe(2);
  expect(partial.wind).toEqual({ min: 7, max: 7 });
  for (const [start, end] of [
    [NaN, base],
    [base, NaN],
    [base + 1, base],
  ]) {
    expect(summarizeWindow(hourly, start, end).samples).toBe(0);
  }
});
test("boundary interpolation preserves null and non-finite fields without hiding known interior values", () => {
  const forecast = windowOf([
    sample(base, { wind: null, gust: null, temperature: NaN, direction: null }),
    sample(base + 3600000, {
      wind: 4,
      gust: 5,
      temperature: 60,
      direction: 230,
    }),
    sample(base + 7200000, {
      wind: NaN,
      gust: NaN,
      temperature: null,
      direction: NaN,
    }),
  ]);
  const point = summarizeWindow(forecast, base + 30 * 60000, base + 30 * 60000);
  expect(point.wind).toBeNull();
  expect(point.gust).toBeNull();
  expect(point.temperature).toBeNull();
  expect(point.direction).toBeNull();
  expect(point.status).toBe("unavailable");
  const s = summarizeWindow(forecast, base + 30 * 60000, base + 90 * 60000);
  expect(s.wind).toEqual({ min: 4, max: 4 });
  expect(s.gust).toBe(5);
  expect(s.temperature).toEqual({ min: 60, max: 60 });
  expect(s.direction!.bearing).toBeCloseTo(230);
  expect(s.status).toBe("favorable");
});
test("summaries report sampled extremes rather than averaging mixed intervals", () => {
  // One brief 15-minute gust spike among calm hours must survive the summary.
  const hours = Array.from({ length: 5 }, (_, i) =>
    sample(base + i * 3600000, { wind: 4, gust: 6, temperature: 60 }),
  );
  const quarter = [
    sample(base + 3600000, { wind: 22, gust: 31, temperature: 71 }, 15),
  ];
  const s = summarizeWindow(windowOf(hours, quarter), base, base + 4 * 3600000);
  expect(s.wind).toEqual({ min: 4, max: 22 });
  expect(s.gust).toBe(31);
  expect(s.temperature).toEqual({ min: 60, max: 71 });
  expect(s.covered).toBe(true);
});
test("summaries take the worst applicable classification, not a typical one", () => {
  const hours = Array.from({ length: 5 }, (_, i) =>
    sample(base + i * 3600000, { wind: 3, direction: 350 }),
  );
  // A single unfavorable quarter-hour inside an otherwise favorable window.
  const quarter = [sample(base + 3600000, { wind: 19, direction: 350 }, 15)];
  const s = summarizeWindow(windowOf(hours, quarter), base, base + 4 * 3600000);
  expect(s.status).toBe("unfavorable");
});
test("summaries skip unavailable samples but report unavailable when none apply", () => {
  const partial = [
    sample(base, { wind: null, direction: null }),
    sample(base + 3600000, { wind: 3, direction: 350 }),
    sample(base + 2 * 3600000, { wind: 3, direction: 350 }),
  ];
  expect(summarizeWindow(windowOf(partial), base, base + 3600000).status).toBe(
    "favorable",
  );
  const none = Array.from({ length: 3 }, (_, i) =>
    sample(base + i * 3600000, { wind: null, direction: null }),
  );
  const s = summarizeWindow(windowOf(none), base, base + 3600000);
  expect(s.status).toBe("unavailable");
  expect(s.wind).toBe(null);
  expect(s.direction).toBe(null);
});
test("summaries average bearings circularly and flag scattered wind as variable", () => {
  // 350° and 10° are 20° apart: circularly they mean 0°, arithmetically 180°.
  const across = [
    sample(base, { direction: 350 }),
    sample(base + 3600000, { direction: 10 }),
  ];
  const s = summarizeWindow(windowOf(across), base, base + 3600000);
  expect(s.direction!.bearing).toBeCloseTo(0, 4);
  expect(s.direction!.variable).toBe(false);
  const scattered = [
    sample(base, { direction: 0 }),
    sample(base + 3600000, { direction: 120 }),
    sample(base + 2 * 3600000, { direction: 240 }),
  ];
  expect(
    summarizeWindow(windowOf(scattered), base, base + 2 * 3600000).direction!
      .variable,
  ).toBe(true);
});
test("summaries range rain probability and never invent a whole-window figure", () => {
  const hours = [
    sample(base, { probability: 10 }),
    sample(base + 3600000, { probability: 40 }),
    sample(base + 2 * 3600000, { probability: null }),
    sample(base + 3 * 3600000, { probability: 0 }),
  ];
  const s = summarizeWindow(windowOf(hours), base, base + 3 * 3600000);
  // 0% is a reading; null is absence. Neither is summed into an event chance.
  expect(s.probability).toEqual({ min: 0, max: 40 });
});
test("gapped and out-of-horizon windows stay visibly incomplete", () => {
  const gapped = [
    sample(base),
    sample(base + 3600000),
    sample(base + 6 * 3600000),
    sample(base + 7 * 3600000),
  ];
  const s = summarizeWindow(windowOf(gapped), base, base + 7 * 3600000);
  expect(s.covered).toBe(false);
  expect(s.samples).toBeGreaterThan(0);
  const beyond = summarizeWindow(
    windowOf([sample(base), sample(base + 3600000)]),
    base + 48 * 3600000,
    base + 52 * 3600000,
  );
  expect(beyond.covered).toBe(false);
  expect(beyond.samples).toBe(0);
  expect(beyond.status).toBe("unavailable");
});
test("rain probability survives the quarter-hour horizon that masks it", () => {
  // Quarter-hour samples override the hourly ones at :00 and carry no
  // probability, so a merged-sample reading would report none at all.
  const hours = [
    sample(base, { probability: 20 }),
    sample(base + 3600000, { probability: 55 }),
  ];
  const quarter = [
    sample(base, { probability: null }, 15),
    sample(base + 3600000, { probability: null }, 15),
  ];
  const s = summarizeWindow(windowOf(hours, quarter), base, base + 3600000);
  expect(s.probability).toEqual({ min: 20, max: 55 });
});

test("probability graph preserves zero, unknown gaps, and preceding-hour bounds", () => {
  const hours = [
    { ...row(base), probability: 0 },
    { ...row(base + 3600000), probability: null },
    { ...row(base + 7200000), probability: 80 },
  ];
  expect(rainChanceIntervals(hours, base - 1800000, base + 5400000)).toEqual([
    { start: base - 1800000, end: base, probability: 0 },
    { start: base + 3600000, end: base + 5400000, probability: 80 },
  ]);
  expect(
    hourlyRainChance(hours, new Date(base).toISOString())?.probability,
  ).toBe(0);
  expect(hourlyRainChance(hours, new Date(base + 1).toISOString())).toBeNull();
  expect(rainChanceIntervals(hours, base + 7200000, base + 10800000)).toEqual(
    [],
  );
});
test("day rulers stay at local midnight, six, noon and eighteen across DST", () => {
  for (const day of ["2026-03-08", "2026-11-01", "2026-09-21"]) {
    const bounds = dayBounds(day);
    expect(
      dayChartTicks(...bounds).map((t) =>
        localDateTime(new Date(t).toISOString()).slice(11, 16),
      ),
    ).toEqual(["00:00", "06:00", "12:00", "18:00"]);
  }
  expect(
    dayChartTicks(base + 24 * 60000, base + 86400000).every(
      (t) => t % 3600000 === 0,
    ),
  ).toBe(true);
});

 test("custom daily periods preserve local times and reject ambiguous DST bounds", () => {
  const custom = [{id: "mid", label: "Mid morning", start: "09:15", end: "11:45"}];
  for (const day of ["2026-09-16", "2026-09-17"]) {
    const [w] = practiceWindows(weather, day, custom);
    expect(localDateTime(new Date(w.startsAt).toISOString())).toBe(day + "T09:15");
    expect(localDateTime(new Date(w.endsAt).toISOString())).toBe(day + "T11:45");
    expect(w.summary.covered).toBe(true);
  }
  for (const [day, start, end] of [["2026-03-08", "01:30", "02:30"], ["2026-11-01", "01:15", "02:30"]]) {
    const [w] = practiceWindows(weather, day, [{...custom[0], start, end}]);
    expect(Number.isNaN(w.startsAt)).toBe(true);
    expect(Number.isNaN(w.endsAt)).toBe(true);
    expect(w.summary.samples).toBe(0);
  }
  expect(practiceWindows(weather, "2026-09-16", [])).toEqual([]);
 });
