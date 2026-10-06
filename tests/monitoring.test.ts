import { describe, expect, it, vi } from "vitest";
import { digestDue, digestWindow } from "../shared/digest";
import { readiness, type Operations } from "../shared/monitoring";
import {
  captureFailure,
  filterEvent,
  safeError,
  safeProperties,
  setTelemetrySink,
  telemetryActor,
  track,
} from "../src/telemetry";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
describe("telemetry privacy and identity", () => {
  it("preserves the configured public ingest token and drops top-level person metadata", () => {
    const event = filterEvent(
      {
        event: "app_opened",
        uuid: A,
        properties: { token: "phc_public_fixture" },
        $set: { email: "private@example.test" },
      } as any,
      "phc_public_fixture",
    );
    expect(event?.properties.token).toBe("phc_public_fixture");
    expect(event?.uuid).toBe(A);
    expect(JSON.stringify(event)).not.toContain("private@example.test");
    expect(
      filterEvent(
        { event: "app_opened", properties: { token: "private-bhc-token" } },
        "phc_public_fixture",
      )?.properties.token,
    ).toBeUndefined();
  });
  it("deduplicates confirmed uploads across a page reload", async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => saved.get(k),
      setItem: (k: string, v: string) => saved.set(k, v),
    });
    const sink = {
      capture: vi.fn(),
      reset: vi.fn(),
      identify: vi.fn(),
      captureException: vi.fn(),
    };
    const once = `confirmed:${A}:${B}`;
    try {
      vi.resetModules();
      const first = await import("../src/telemetry");
      first.setTelemetrySink(sink);
      first.telemetryActor(A);
      first.track("report_save_confirmed", {}, A, once);
      vi.resetModules();
      const reloaded = await import("../src/telemetry");
      reloaded.setTelemetrySink(sink);
      reloaded.telemetryActor(A);
      reloaded.track("report_save_confirmed", {}, A, once);
      expect(sink.capture).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("drops raw URLs, emails, codes, report text, tokens, and SDK person properties", () => {
    const privateData = {
      email: "private@example.test",
      token: "private-token",
      notes: "private-report",
      $current_url: "https://mendocean.fyi/?code=123456",
      $set: { email: "private@example.test" },
    };
    expect(
      safeProperties({
        ...privateData,
        screen: "Today",
        build: "test-123",
        category: "server",
      }),
    ).toEqual({ screen: "Today", build: "test-123", category: "server" });
    const event = filterEvent({
      event: "$identify",
      properties: { ...privateData, distinct_id: A },
    });
    expect(event?.properties).toEqual({ distinct_id: A, $geoip_disable: true });
    expect(
      filterEvent({ event: "$pageview", properties: privateData }),
    ).toBeNull();
    expect(
      filterEvent({ event: "$exception", properties: privateData }),
    ).toBeNull();
  });
  it("retains safe source locations and chunk IDs but strips exception values and local variables", () => {
    const error = new Error("private-token private-report");
    error.stack =
      "Error: private-token\n at f (https://mendocean.fyi/assets/main-abc.js:10:20)\n at https://provider.test/?token=private-token:1:2";
    expect(safeError(error, "api").stack).toBe(
      "Error: Unexpected api failure\n    at https://mendocean.fyi/assets/main-abc.js:10:20",
    );
    const event = filterEvent({
      event: "$exception",
      properties: {
        operation: "api",
        mendocean_sanitized: true,
        $release_id: "release-123",
        $exception_list: [
          {
            value: "private-token",
            stacktrace: {
              frames: [
                {
                  filename: "https://mendocean.fyi/assets/main-abc.js",
                  lineno: 10,
                  colno: 20,
                  chunk_id: "chunk-123",
                  vars: { token: "private-token" },
                  context_line: "private-report",
                },
                {
                  filename: "https://provider.test/?token=private-token",
                  lineno: 1,
                },
              ],
            },
          },
        ],
      },
    });
    expect(JSON.stringify(event)).not.toContain("private-");
    expect(JSON.stringify(event)).toContain("chunk-123");
    expect(event?.properties.$release_id).toBe("release-123");
  });
  it("resets identities, suppresses old account completions, and deduplicates retries", () => {
    const sink = {
      capture: vi.fn(),
      reset: vi.fn(),
      identify: vi.fn(),
      captureException: vi.fn(),
    };
    setTelemetrySink(sink);
    telemetryActor(A);
    track("report_save_confirmed", {}, A, "monitor-test-retry");
    track("report_save_confirmed", {}, A, "monitor-test-retry");
    expect(sink.capture).toHaveBeenCalledTimes(1);
    telemetryActor(B);
    track("report_save_confirmed", {}, A);
    captureFailure(new Error("secret"), "api", undefined, A);
    expect(sink.capture).toHaveBeenCalledTimes(1);
    expect(sink.captureException).not.toHaveBeenCalled();
    telemetryActor(null);
    expect(sink.identify.mock.calls).toEqual([[A], [B]]);
    expect(sink.reset).toHaveBeenCalledTimes(3);
    setTelemetrySink();
  });
  it("cannot leak the prior identity when reset fails and never blocks the app", () => {
    const sink = {
      capture: vi.fn(),
      reset: () => {
        throw new Error("unavailable");
      },
      identify: vi.fn(),
      captureException: vi.fn(),
    };
    setTelemetrySink(sink);
    expect(() => telemetryActor(A)).not.toThrow();
    track("app_opened");
    expect(sink.capture).not.toHaveBeenCalled();
    telemetryActor(null);
  });
});
describe("readiness", () => {
  const now = Date.parse("2026-10-05T14:00Z");
  const good: Operations = {
    started_at: new Date(now).toISOString(),
    last_weather: new Date(now).toISOString(),
    last_tick_started_at: null,
    last_tick_completed_at: new Date(now).toISOString(),
    overdue_jobs: 0,
    retries_24h: 20,
    failed_jobs_24h: 0,
    api_failures_15m: 0,
    api_affected_users_15m: 0,
    bhc_problems: 1,
    reminder_problems: 1,
    recent_events: [],
  };
  it("keeps individual retries/BHC issues out of widespread incidents", () =>
    expect(readiness(good, now).status).toBe("ready"));
  it("fails on absent/stale weather, incomplete dispatch, overdue queue, or multi-user failures", () => {
    expect(readiness({ ...good, last_weather: null }, now).reasons).toEqual([
      "weather_stale",
    ]);
    expect(
      readiness(
        {
          ...good,
          last_tick_started_at: new Date(now).toISOString(),
          last_tick_completed_at: new Date(now - 16 * 60000).toISOString(),
        },
        now,
      ).reasons,
    ).toEqual(["dispatcher_stalled"]);
    expect(readiness({ ...good, overdue_jobs: 1 }, now).reasons).toEqual([
      "queue_stalled",
    ]);
    expect(
      readiness(
        { ...good, api_failures_15m: 5, api_affected_users_15m: 2 },
        now,
      ).reasons,
    ).toEqual(["api_failures"]);
    expect(
      readiness(
        { ...good, api_failures_15m: 5, api_affected_users_15m: 1 },
        now,
      ).status,
    ).toBe("ready");
  });
});
describe("digest calendar boundaries", () => {
  it.each([
    [
      "2026-03-09T13:05Z",
      "2026-03-02",
      "2026-03-02T06:00:00.000Z",
      "2026-03-09T05:00:00.000Z",
    ],
    [
      "2026-11-02T14:05Z",
      "2026-10-26",
      "2026-10-26T05:00:00.000Z",
      "2026-11-02T06:00:00.000Z",
    ],
  ])(
    "uses complete Chicago weeks across DST (%s)",
    (date, week, start, end) => {
      expect(digestWindow(Date.parse(date))).toEqual({ week, start, end });
      expect(digestDue(Date.parse(date))).toBe(true);
      expect(digestDue(Date.parse(date) + 3600000)).toBe(false);
      expect(digestDue(Date.parse(date) + 86400000)).toBe(false);
    },
  );
});
