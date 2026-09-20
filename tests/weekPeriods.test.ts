import { expect, test } from "vitest";
import {
  DEFAULT_WEEK_PERIODS,
  weekPeriodsSchema,
  sortPeriods,
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
