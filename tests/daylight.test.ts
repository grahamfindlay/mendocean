import { expect, test } from "vitest";
import { daylightPeriods } from "../src/daylight";
import { chicagoToISO, localDateTime } from "../shared/domain";
import { dayBounds } from "../shared/timeline";

test("solar times belong to the displayed Madison day in summer and winter", () => {
  const duration = (day: string) => {
    const [start, end] = dayBounds(day);
    const periods = daylightPeriods(start, end);
    expect(periods).toHaveLength(1);
    const p = periods[0];
    expect(p.day).toBe(day);
    for (const time of [p.sunrise, p.sunset]) {
      expect(time).toBeGreaterThan(start);
      expect(time).toBeLessThan(end);
      expect(localDateTime(new Date(time).toISOString()).slice(0, 10)).toBe(
        day,
      );
    }
    return (p.sunset - p.sunrise) / 3600000;
  };
  expect(duration("2026-06-21")).toBeGreaterThan(15);
  expect(duration("2026-12-21")).toBeLessThan(10);
});

test.each(["2026-03-08", "2026-11-01"])(
  "DST day %s and an exclusive midnight boundary use the right solar days",
  (day) => {
    const [start, end] = dayBounds(day);
    expect(daylightPeriods(start, end).map((p) => p.day)).toEqual([day]);
    const nextDay = localDateTime(new Date(end).toISOString()).slice(0, 10);
    expect(daylightPeriods(start, end + 60000).map((p) => p.day)).toEqual([
      day,
      nextDay,
    ]);
    // A nighttime-only interval still has the day's solar times for its description.
    expect(daylightPeriods(start, start + 3600000)).toEqual(
      daylightPeriods(start, end),
    );
    const noon = Date.parse(chicagoToISO(day + "T12:00"));
    const [p] = daylightPeriods(start, end);
    expect(p.sunrise).toBeLessThan(noon);
    expect(p.sunset).toBeGreaterThan(noon);
  },
);

test("empty and invalid domains have no solar periods", () => {
  expect(daylightPeriods(1, 1)).toEqual([]);
  expect(daylightPeriods(2, 1)).toEqual([]);
  expect(daylightPeriods(NaN, 1)).toEqual([]);
  expect(daylightPeriods(1, Infinity)).toEqual([]);
});
