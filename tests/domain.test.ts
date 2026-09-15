import { describe, expect, it } from "vitest";
import {
  boatExtremes,
  chicagoToISO,
  circularMean,
  reportSchema,
  outingSchema,
  weatherFreshness,
  windStatus,
  windZone,
} from "../shared/domain";
import { normalizeWeather } from "../shared/weather";
import {
  bhcAttendance,
  bhcBoatClass,
  normalizePractice,
  syncTimes,
} from "../shared/bhc";
import { reminderEligible } from "../shared/reminders";
import { report } from "./fixtures";
describe("Hannah’s unchanged rule", () => {
  it("uses exact sector boundaries and wraps bearings", () => {
    expect(
      [11.24999, 11.25, 78.74999, 78.75, 258.74999, 258.75, 360, -1].map(
        windZone,
      ),
    ).toEqual([1, 3, 3, 2, 2, 1, 1, 1]);
  });
  it("classifies unrounded speeds at every threshold", () => {
    expect(
      [4.999, 5, 9.999, 10, 14.999, 15].map((s) => windStatus(s, 180)),
    ).toEqual([
      "favorable",
      "favorable",
      "favorable",
      "caution",
      "caution",
      "unfavorable",
    ]);
    expect(windStatus(5, 0)).toBe("unfavorable");
    expect(windStatus(5, 45)).toBe("caution");
    expect(windStatus(10, 45)).toBe("unfavorable");
  });
  it("does not invent calm weather", () => {
    expect(windStatus(null, 0)).toBe("unavailable");
    expect(windStatus(0, null)).toBe("unavailable");
    expect(windStatus(NaN, 2)).toBe("unavailable");
    expect(windStatus(-1, 2)).toBe("unavailable");
  });
});
it("handles Madison timezone regardless of the device and rejects DST ambiguity", () => {
  expect(chicagoToISO("2026-09-12T07:30")).toBe("2026-09-12T12:30:00.000Z");
  expect(chicagoToISO("2026-01-12T07:30")).toBe("2026-01-12T13:30:00.000Z");
  expect(() => chicagoToISO("2026-03-08T02:30")).toThrow();
  expect(() => chicagoToISO("2026-11-01T01:30")).toThrow();
});
it("averages compass bearings circularly", () => {
  expect(circularMean([350, 10])! % 360).toBeCloseTo(0);
  expect(circularMean([90, 270])).toBeNull();
});
it("keeps boat classes distinct while finding crew size extremes", () => {
  expect(boatExtremes(["2x", "2−", "8+"])).toEqual({ smallest: 2, largest: 8 });
});
it("validates observations without converting absence into a negative row", () => {
  expect(reportSchema.safeParse(report({ rating: 5 })).success).toBe(true);
  expect(
    reportSchema.safeParse(report({ outcome: "did_not_attend", rating: 2 }))
      .success,
  ).toBe(false);
  expect(
    reportSchema.safeParse(
      report({ coach_ids: [crypto.randomUUID()], coach_count: 0 }),
    ).success,
  ).toBe(false);
  expect(
    reportSchema.safeParse(
      report({
        segments: [
          { route: "east", rating: 1 },
          { route: "east", rating: 2 },
        ],
      }),
    ).success,
  ).toBe(false);
});
it("preserves provider nulls and absolute time", () => {
  const raw = {
    hourly: {
      time: [1700000000],
      wind_speed_10m: [null],
      wind_direction_10m: [0],
    },
  };
  const f = normalizeWeather(raw);
  expect(f.hours[0].wind).toBeNull();
  expect(f.hours[0].time).toBe(new Date(1700000000000).toISOString());
  expect(f.current).toBeNull();
});
it("expires old weather", () => {
  expect(weatherFreshness(new Date(0).toISOString(), 3 * 3600000)).toBe(
    "stale",
  );
  expect(weatherFreshness(new Date(0).toISOString(), 7 * 3600000)).toBe(
    "expired",
  );
});
it("keeps unknown and declined attendance separate", () => {
  expect(
    ["Attending", "Not Attending", "unknown", null].map(bhcAttendance),
  ).toEqual(["attending", "declined", "unknown", "unknown"]);
});
it("normalizes real rigging shapes without guessing mixed or missing rigging", () => {
  expect(
    bhcBoatClass({
      boat_type: 2,
      rigging: [{ seat_side: "Sculling" }, { seat_side: "Sculling" }],
      coxed: "No",
    }),
  ).toBe("2x");
  expect(
    bhcBoatClass({
      boat_type: 4,
      rigging: [{ seat_side: "Port" }, { seat_side: "Starboard" }],
      coxed: "Yes",
    }),
  ).toBe("4+");
  expect(bhcBoatClass({ boat_type: 2, rigging: [] })).toBeNull();
});
it("deduplicates coaches and ignores reserved fleet when no seats are assigned", () => {
  const p = normalizePractice(
    {
      practice_id: 1,
      start_time: 1700000000,
      end_time: 1700003600,
      name: "Fixture practice",
      current_attendance_status: "Attending",
    },
    {
      attendance: [],
      assigned_coaches: [
        { custid: 90, fname: "Coach" },
        { custid: 90, fname: "Coach" },
      ],
      equipment: [{ boats: [{ boat_id: 2 }] }],
    },
    42,
    [{ boat_id: 2, boat_type: 8 }],
  );
  expect(p.coaches).toHaveLength(1);
  expect(p.planned_boats).toEqual([]);
  expect(p.planned_boat).toBeNull();
});
it("schedules around actual per-practice deadlines", () => {
  const result = syncTimes(
    {
      starts_at: "2026-09-12T12:30:00Z",
      ends_at: "2026-09-12T14:15:00Z",
      deadline: "2026-09-11T22:30:00Z",
    },
    0,
  );
  expect(result.map((n) => new Date(n).toISOString())).toEqual([
    "2026-09-11T22:35:00.000Z",
    "2026-09-12T11:30:00.000Z",
    "2026-09-12T14:25:00.000Z",
  ]);
});
it("suppresses reminders for declines, existing reports, skips, pauses and expired outings", () => {
  const base = {
    attendance: "attending",
    reminder: true,
    skipped: false,
    hasReport: false,
    paused: false,
    channel: "email",
    endsAt: new Date(0).toISOString(),
  };
  expect(reminderEligible(base, 900000)).toBe(true);
  for (const patch of [
    { attendance: "declined" },
    { attendance: "unknown" },
    { hasReport: true },
    { skipped: true },
    { paused: true },
    { channel: "none" },
  ])
    expect(reminderEligible({ ...base, ...patch }, 900000)).toBe(false);
  expect(reminderEligible(base, 2 * 86400000)).toBe(false);
});

it("rejects non-rowing boat observations in the shared validator", () => {
  expect(
    reportSchema.safeParse(
      report({ outcome: "did_not_attend", rating: null, boat_class: "1x" }),
    ).success,
  ).toBe(false);
});

it("accepts PostgREST timestamp offsets when editing imported or existing outings", () => {
  const input = {
    id: "20000000-0000-4000-8000-000000000099",
    kind: "official",
    title: "Practice",
    starts_at: "2026-09-14T12:00:00+00:00",
    ends_at: "2026-09-14T13:00:00+00:00",
  };
  expect(outingSchema.safeParse(input).success).toBe(true);
  expect(
    outingSchema.safeParse({ ...input, ends_at: "2026-09-14T08:00:00-05:00" })
      .success,
  ).toBe(true);
  expect(
    outingSchema.safeParse({ ...input, ends_at: "2026-09-14T13:00:00+02:00" })
      .success,
  ).toBe(false);
});
