import { expect, test } from "vitest";
import {
  DEFAULT_WEEK_PERIODS,
  weekPeriodsSchema,
  sortPeriods,
  periodsForDay,
  periodDaysLabel,
} from "../shared/weekPeriods";
test("period preferences validate times, identities and bounds", () => {
  expect(weekPeriodsSchema.parse(DEFAULT_WEEK_PERIODS)).toHaveLength(2);
  expect(weekPeriodsSchema.parse([])).toEqual([]);
  for (const change of [
    { start: "24:00" },
    { end: "05:30" },
    { end: "01:00" },
    { label: "  " },
    { label: "a".repeat(41) },
  ])
    expect(
      weekPeriodsSchema.safeParse([{ ...DEFAULT_WEEK_PERIODS[0], ...change }])
        .success,
    ).toBe(false);
  expect(
    weekPeriodsSchema.safeParse([
      DEFAULT_WEEK_PERIODS[0],
      DEFAULT_WEEK_PERIODS[0],
    ]).success,
  ).toBe(false);
  expect(
    weekPeriodsSchema.safeParse(
      Array.from({ length: 13 }, (_, i) => ({
        ...DEFAULT_WEEK_PERIODS[0],
        id: String(i),
      })),
    ).success,
  ).toBe(false);
  expect(
    sortPeriods([...DEFAULT_WEEK_PERIODS].reverse()).map((p) => p.id),
  ).toEqual(["morning", "evening"]);
});

test("legacy periods default to every day and weekday selections are validated", () => {
  const {days, ...legacy} = DEFAULT_WEEK_PERIODS[0];
  expect(weekPeriodsSchema.parse([legacy])[0].days).toEqual([0,1,2,3,4,5,6]);
  for (const invalid of [[], [0,0], [-1], [7], [1.5], ["1"], null])
    expect(weekPeriodsSchema.safeParse([{...legacy,days:invalid}]).success).toBe(false);
  expect(weekPeriodsSchema.parse([{...legacy,days:[6,0,2]}])[0].days).toEqual([0,2,6]);
});
test("weekday eligibility uses the local date across DST and year boundaries", () => {
  const period = {...DEFAULT_WEEK_PERIODS[0], days:[0,2,4]};
  for (const date of ["2026-09-21", "2026-09-23", "2026-09-25", "2027-01-01"])
    expect(periodsForDay([period],date)).toHaveLength(1);
  for (const date of ["2026-09-22", "2026-09-26", "2026-03-08", "2026-11-01"])
    expect(periodsForDay([period],date)).toEqual([]);
  expect(periodsForDay([{...period,enabled:false}],"2026-09-21")).toEqual([]);
  expect(periodDaysLabel([0,1,2,3,4])).toBe("Weekdays");
  expect(periodDaysLabel([5,6])).toBe("Weekends");
  expect(periodDaysLabel([0,2,4])).toBe("Mon, Wed, Fri");
});
