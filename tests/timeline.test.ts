import { expect, test } from "vitest";
import { normalizeWeather, weatherURL } from "../shared/weather";
import {
  comparisonTimes,
  nearTerm,
  precipitationRate,
  timelineSamples,
  windowSamples,
  summarySamples,
  hourlyRainChance,
  dayBounds,
} from "../shared/timeline";
import { forecastSamples } from "../shared/presentation";
import {
  chicagoToISO,
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
test("five-day comparisons retain selected minutes and detect DST nonexistent local times", () => {
  const times = comparisonTimes(weather, "2026-09-15T09:43", now);
  expect(times).toHaveLength(5);
  expect(times.every((t) => localDateTime(t.time!).endsWith("09:43"))).toBe(
    true,
  );
  const dstBase = Date.parse("2026-03-07T06:00:00Z");
  const dst = {
    ...weather,
    quarter_hours: [],
    hours: Array.from({ length: 144 }, (_, i) => row(dstBase + i * 3600000)),
  };
  expect(
    comparisonTimes(dst, "2026-03-07T02:30", dstBase).find(
      (d) => d.day === "2026-03-08",
    )?.time,
  ).toBeNull();
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
