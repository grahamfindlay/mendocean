import { expect, test } from "vitest";
import {
  canLog,
  outingPhase,
  sortedOutings,
  forecastSamples,
  weatherDescription,
} from "../shared/presentation";
import {
  reminderPresentation,
  reminderScheduleError,
} from "../shared/reminders";
import type { Forecast, Outing } from "../shared/domain";
const now = Date.parse("2026-09-15T14:24:00Z");
const outing = (start: string, end: string): Outing => ({
  id: "fixture",
  kind: "official",
  title: "Fixture",
  starts_at: start,
  ends_at: end,
  reminder: true,
  attendance: "attending",
  owner_id: null,
  bhc_practice_id: 1,
  version: 1,
  planned_boat: null,
});
const current = outing("2026-09-15T14:00:00Z", "2026-09-15T15:30:00Z");
const future = outing("2026-09-16T14:00:00Z", "2026-09-16T15:30:00Z");
const past = outing("2026-09-15T12:00:00Z", "2026-09-15T13:30:00Z");
const profile = { reminder_channel: "email", reminders_paused: false };
test("logging begins exactly at start, while Past begins exactly at end", () => {
  expect(canLog(current, Date.parse(current.starts_at) - 1)).toBe(false);
  expect(canLog(current, Date.parse(current.starts_at))).toBe(true);
  expect(outingPhase(current, now)).toBe("in_progress");
  expect(outingPhase(current, Date.parse(current.ends_at))).toBe("past");
  expect(canLog(future, now)).toBe(false);
  expect(sortedOutings([future, past, current], "Upcoming", now)).toEqual([
    current,
    future,
  ]);
  expect(
    sortedOutings([past, current, future], "Past", Date.parse(future.ends_at)),
  ).toEqual([future, current, past]);
});
test("Now uses the latest actual timestamp and upcoming rows never look backward", () => {
  const hour = (time: string) => ({
    time,
    wind: 8,
    direction: 350,
    gust: 12,
    temperature: 65,
    precipitation: 0,
    probability: 0,
    visibility: 10000,
    code: 2,
  });
  const weather: Forecast = {
    hours: [hour("2026-09-15T15:00:00Z"), hour("2026-09-15T14:00:00Z")],
    current: hour("2026-09-15T13:00:00Z"),
    fetched_at: new Date(now).toISOString(),
    provider: "fixture",
    model_version: "hannah-1.0.0",
    source_kind: "fixture",
  };
  expect(forecastSamples(weather, now).current?.time).toBe(
    "2026-09-15T14:00:00Z",
  );
  expect(forecastSamples(weather, now).upcoming.map((h) => h.time)).toEqual([
    "2026-09-15T15:00:00Z",
  ]);
  weather.current = { ...hour("2026-09-15T14:00:00Z"), wind: 9 };
  expect(forecastSamples(weather, now).current?.wind).toBe(9);
  weather.current = hour("2026-09-15T14:15:00Z");
  expect(forecastSamples(weather, now).current?.time).toBe(
    "2026-09-15T14:15:00Z",
  );
  expect(
    forecastSamples(weather, Date.parse("2026-09-15T16:00:00Z")).current,
  ).toBeUndefined();
});
test("reminder preference, scheduled and sent are distinct; saved reports hide controls", () => {
  expect(reminderPresentation(future, profile, now)?.text).toBe(
    "Logging reminder: On",
  );
  expect(
    reminderPresentation(
      {
        ...future,
        reminder_state: { due_at: "2026-09-16T15:45:00Z", sent_at: null },
      },
      profile,
      now,
    )?.text,
  ).toBe("Logging reminder scheduled");
  expect(
    reminderPresentation(
      {
        ...past,
        reminder_state: { due_at: null, sent_at: "2026-09-15T14:00:00Z" },
      },
      profile,
      now,
    )?.text,
  ).toBe("Logging reminder sent");
  expect(
    reminderPresentation({ ...past, reports: [{} as never] }, profile, now),
  ).toBeNull();
  expect(
    reminderPresentation({ ...past, skipped: true }, profile, now)?.text,
  ).toBe("Logging reminder: Off");
});
test("reminder scheduling honors attendance, account state, expiry and one-hour boundary", () => {
  for (const attendance of ["declined", "unknown"])
    expect(
      reminderScheduleError({ ...past, attendance }, profile, "enable", now),
    ).toMatch(/attending/);
  expect(
    reminderScheduleError(
      past,
      { ...profile, reminder_channel: "none" },
      "enable",
      now,
    ),
  ).toMatch(/channel/);
  expect(
    reminderScheduleError(
      past,
      { ...profile, reminders_paused: true },
      "enable",
      now,
    ),
  ).toMatch(/paused/);
  expect(reminderScheduleError(current, profile, "snooze", now)).toMatch(
    /ends/,
  );
  expect(reminderScheduleError(past, profile, "snooze", now)).toBeNull();
  const expiry = Date.parse(past.ends_at) + 86400000;
  expect(
    reminderScheduleError(past, profile, "snooze", expiry - 3600000),
  ).toBeNull();
  expect(
    reminderScheduleError(past, profile, "snooze", expiry - 3600000 + 1),
  ).toMatch(/window/);
  expect(reminderPresentation(past, profile, expiry + 1)).toBeNull();
  expect(canLog(past, expiry + 1)).toBe(true);
});
test("weather descriptions distinguish missing codes from clear skies", () => {
  expect(weatherDescription(null)).toBe("Conditions unavailable");
  expect(weatherDescription(0)).toBe("Clear");
  expect(weatherDescription(2)).toBe("Partly cloudy");
  expect(weatherDescription(65)).toBe("Rain");
  expect(weatherDescription(95)).toBe("Thunderstorms");
});

test("multiple reminder channels treat an explicit empty selection as off and surface partial delivery", () => {
  const both = {
    reminder_channel: "email",
    reminder_channels: ["email", "push"],
    reminders_paused: false,
  };
  expect(reminderScheduleError(past, both, "enable", now)).toBeNull();
  expect(
    reminderScheduleError(
      past,
      { ...both, reminder_channels: [] },
      "enable",
      now,
    ),
  ).toContain("Choose");
  const state = reminderPresentation(
    {
      ...past,
      reminder: true,
      reminder_state: {
        sent_at: null,
        due_at: "2026-09-15T14:30:00Z",
        channels: [
          {
            channel: "email",
            sent_at: "2026-09-15T14:00:00Z",
            error: null,
            status: "sent",
            devices_sent: 0,
          },
          {
            channel: "push",
            sent_at: null,
            error: "no_device",
            status: "retrying",
            devices_sent: 0,
          },
        ],
      },
    },
    both,
    now,
  );
  expect(state?.text).toBe("Logging reminder partially sent");
  expect(state?.snooze).toBe(true);
});
