import { describe, expect, it } from "vitest";
import {
  circularMean,
  parseBuoy,
  parseIEM,
  parseVC,
  summarizeObservations,
  outingMeasurements,
  type Observation,
} from "../shared/observations";
import { readiness, type Operations } from "../shared/monitoring";
const sample = (
  minute: number,
  wind: number | null = 5,
  extra = {},
): Observation => ({
  source: "buoy",
  observed_at: `2026-10-07T12:${String(minute).padStart(2, "0")}:00Z`,
  wind,
  gust: wind === null ? null : wind + 3,
  direction: 350,
  temperature: 60,
  stations: ["buoy"],
  flags: [],
  definition: "two-minute mean",
  ...extra,
});
describe("measured weather evidence", () => {
  it("preserves nulls, converts units and distinguishes gust definitions", () => {
    const b = parseBuoy({
      code: 200,
      results: {
        timestamps: ["2026-10-07T12:00Z"],
        symbols: [
          "mendota.buoy.air_temp",
          "run_wind_speed",
          "gust",
          "wind_direction",
        ],
        data: [[0, 0, null, 0]],
      },
    })[0];
    expect(b.wind).toBe(0);
    expect(b.temperature).toBe(32);
    expect(b.gust).toBeNull();
    expect(b.definition).toContain("trailing 2-minute maximum");
    expect(() => parseBuoy({ code: 500 })).toThrow();
    expect(() => parseVC({ currentConditions: { source: "fcst" } })).toThrow();
  });
  it("derives precision METAR temperatures and gusts without inventing missing gusts", () => {
    const r = parseIEM({
      data: [
        {
          utc_valid: "2026-10-07T12:00Z",
          sknt: 10,
          drct: 180,
          tmpf: null,
          gust: null,
          raw: "KMSN 071200Z 18010G20KT RMK T10100050 MADISHF",
        },
      ],
    })[0];
    expect(r.temperature).toBe(30.2);
    expect(r.gust).toBeCloseTo(23.0156);
    expect(r.flags).toContain("temperature_derived_from_metar");
    expect(
      parseIEM({
        last_ob: { utc_valid: "2026-10-07T12:00Z", sknt: 0, gust: null },
      })[0].gust,
    ).toBeNull();
  });
  it("averages north across the circular boundary and ignores calm direction", () => {
    expect(
      circularMean([
        { wind: 5, direction: 350 },
        { wind: 5, direction: 10 },
      ]),
    ).toBeCloseTo(0);
    expect(circularMean([{ wind: 0, direction: 180 }])).toBeNull();
    expect(
      circularMean([
        { wind: 5, direction: 90 },
        { wind: 5, direction: 270 },
      ]),
    ).toBeNull();
  });
  it("retains peaks, excludes incomplete current bins, and doesn't count duplicates", () => {
    const rows = [
      sample(0, 1),
      sample(1, 3),
      sample(2, 10),
      sample(3, 3),
      sample(4, 3),
      sample(4, 3),
      sample(5, 99),
    ];
    const summaries = summarizeObservations(rows, "2026-10-07T12:06Z", ["raw"]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].sample_count).toBe(5);
    expect(summaries[0].wind).toBe(4);
    expect(summaries[0].wind_max).toBe(10);
    expect(summaries[0].gust).toBe(13);
    const report = outingMeasurements(
      summaries,
      "2026-10-07T12:00Z",
      "2026-10-07T12:10Z",
    )[0];
    expect(report.bins).toBe(1);
    expect(report.expected_bins).toBe(2);
    expect(report.wind).toBe(4);
    expect(
      outingMeasurements([], "2026-10-07T12:00Z", "2026-10-07T12:10Z")[0].wind,
    ).toBeNull();
  });
  it("preserves suspicious VC gusts and returned stations", () => {
    const r = parseVC({
      currentConditions: {
        datetimeEpoch: 1,
        source: "obs",
        stations: ["KMSN", "F3620"],
        windspeed: 5,
        windgust: 0,
        temp: null,
        winddir: 180,
      },
    })[0];
    expect(r.gust).toBe(0);
    expect(r.flags).toContain("gust_below_wind");
    expect(r.stations).toHaveLength(2);
  });
  it("alerts only after source startup grace, and ignores an ended VC trial", () => {
    const now = Date.parse("2026-10-07T12:00Z");
    const base = {
      last_weather: new Date(now).toISOString(),
      last_tick_completed_at: new Date(now).toISOString(),
      overdue_jobs: 0,
      api_failures_15m: 0,
      api_affected_users_15m: 0,
    } as Operations;
    base.weather_observations = {
      sources: [
        {
          source: "buoy",
          enabled_at: "2026-10-07T10:00Z",
          last_success: "2026-10-07T11:59Z",
          latest_observed_at: "2026-10-07T10:00Z",
          failures: 0,
          last_error: null,
          trial_ends_at: null,
          review_due: false,
        },
      ],
      database_bytes: 1,
      storage_bytes: 1,
      archive_days: 0,
      unenriched_reports: 0,
    };
    expect(readiness(base, now).reasons).toContain("observations_buoy_stale");
    base.weather_observations.sources[0].enabled_at = "2026-10-07T11:59Z";
    expect(readiness(base, now).reasons).toEqual([]);
    base.weather_observations.storage_bytes = 700e6;
    expect(readiness(base, now).reasons).toContain("archive_capacity");
  });
});
