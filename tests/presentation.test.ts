import { expect, test } from "vitest";
import {
  canLog,
  outingPhase,
  visibleOutings,
  forecastSamples,
  weatherDescription,
  type RowFilters,
} from "../shared/presentation";
import {
  accountReminderBlock,
  reminderBlock,
  reminderBlockMessage,
  reminderPresentation,
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
  expect(visibleOutings([future, past, current], "Upcoming", now)).toEqual([
    current,
    future,
  ]);
  expect(
    visibleOutings([past, current, future], "Past", Date.parse(future.ends_at)),
  ).toEqual([future, current, past]);
});
test("the attendance filter describes practices only and never hides independent rows", () => {
  const at = (hour: number, over: Partial<Outing>): Outing => ({
    ...outing(`2026-09-16T1${hour}:00:00Z`, `2026-09-16T1${hour}:30:00Z`),
    ...over,
  });
  const rows = [
    at(4, {
      id: "mine",
      kind: "independent",
      attendance: undefined,
      owner_id: "me",
      bhc_practice_id: null,
    }),
    at(3, { id: "blank", attendance: "" }),
    at(2, { id: "unknown", attendance: undefined }),
    at(1, { id: "declined", attendance: "declined" }),
    at(0, { id: "attending" }),
  ];
  const ids = (filters?: RowFilters) =>
    visibleOutings(rows, "Upcoming", now, filters).map((o) => o.id);
  expect(ids()).toEqual(["attending", "declined", "unknown", "blank", "mine"]);
  // The trap this helper exists to prevent: intersecting the two filters
  // returns ["attending"] here and drops a row the owner scheduled themselves.
  expect(ids({ attendance: "Attending" })).toEqual(["attending", "mine"]);
  expect(ids({ attendance: "Not attending" })).toEqual(["declined", "mine"]);
  // Absent and empty both read as unknown, matching the importer's mapping.
  expect(ids({ attendance: "Unknown" })).toEqual(["unknown", "blank", "mine"]);
  // Type alone governs independent rows, in either direction.
  expect(ids({ type: "Independent" })).toEqual(["mine"]);
  expect(ids({ type: "Independent", attendance: "Not attending" })).toEqual([
    "mine",
  ]);
  expect(ids({ type: "Practices" })).toEqual([
    "attending",
    "declined",
    "unknown",
    "blank",
  ]);
  expect(ids({ type: "Practices", attendance: "Attending" })).toEqual([
    "attending",
  ]);
});
test("Past is a union: independent rows, attended practices and anything logged", () => {
  const at = (hour: number, over: Partial<Outing>): Outing => ({
    ...outing(`2026-09-14T1${hour}:00:00Z`, `2026-09-14T1${hour}:30:00Z`),
    ...over,
  });
  const rows = [
    at(0, { id: "attended" }),
    at(1, { id: "missed", attendance: "declined" }),
    at(2, {
      id: "logged-then-dropped",
      attendance: "declined",
      reports: [{} as never],
    }),
    at(3, { id: "unknown", attendance: undefined }),
    at(4, {
      id: "mine",
      kind: "independent",
      attendance: undefined,
      owner_id: "me",
      bhc_practice_id: null,
    }),
  ];
  const ids = (filters?: RowFilters) =>
    visibleOutings(rows, "Past", now, filters).map((o) => o.id);
  // Newest first, and the report survives BHC saying the owner did not attend.
  // Without that clause a log they wrote would vanish from their own history.
  expect(ids()).toEqual(["mine", "logged-then-dropped", "attended"]);
  expect(ids({ allPractices: true })).toEqual([
    "mine",
    "unknown",
    "logged-then-dropped",
    "missed",
    "attended",
  ]);
  // The report filter composes with the default set rather than replacing it.
  expect(ids({ reports: "Logged" })).toEqual(["logged-then-dropped"]);
  expect(ids({ reports: "Unlogged" })).toEqual(["mine", "attended"]);
  expect(ids({ reports: "Unlogged", allPractices: true })).toEqual([
    "mine",
    "unknown",
    "missed",
    "attended",
  ]);
  // Upcoming is untouched by it: a practice the owner declined is still ahead
  // of them, and R29's filters decide whether it shows.
  const ahead = { ...future, id: "ahead", attendance: "declined" };
  expect(visibleOutings([ahead], "Upcoming", now).map((o) => o.id)).toEqual([
    "ahead",
  ]);
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
    expect(reminderBlock({ ...past, attendance }, profile, "enable", now)).toBe(
      "not_attending",
    );
  expect(
    reminderBlock(
      past,
      { ...profile, reminder_channel: "none" },
      "enable",
      now,
    ),
  ).toBe("no_channel");
  expect(
    reminderBlock(past, { ...profile, reminders_paused: true }, "enable", now),
  ).toBe("paused");
  expect(reminderBlock(current, profile, "snooze", now)).toBe("not_ended");
  expect(reminderBlock(past, profile, "snooze", now)).toBeNull();
  const expiry = Date.parse(past.ends_at) + 86400000;
  expect(reminderBlock(past, profile, "snooze", expiry - 3600000)).toBeNull();
  expect(reminderBlock(past, profile, "snooze", expiry - 3600000 + 1)).toBe(
    "window_closed",
  );
  expect(reminderPresentation(past, profile, expiry + 1)).toBeNull();
  expect(canLog(past, expiry + 1)).toBe(true);
  // The API still answers in words; only the card stopped repeating them.
  expect(reminderBlockMessage("not_attending")).toMatch(/attending/);
});
test("an ineligible row says nothing, and an account-level reason is said once", () => {
  // The situation itself, which the card already shows through its attendance
  // badge. Repeating it in a sentence on every practice is what R28 removes.
  expect(
    reminderPresentation({ ...future, attendance: "declined" }, profile, now),
  ).toBeNull();
  const paused = { ...profile, reminders_paused: true };
  expect(reminderPresentation(future, paused, now)).toBeNull();
  expect(accountReminderBlock([future], paused, now)).toBe("paused");
  expect(
    accountReminderBlock([future], { ...profile, reminder_channel: "" }, now),
  ).toBe("no_channel");
  // Not raised by rows that could not carry a reminder anyway: a declined
  // practice, one already logged, and one past its window.
  expect(
    accountReminderBlock(
      [
        { ...future, attendance: "declined" },
        { ...future, reports: [{} as never] },
        past,
      ],
      paused,
      Date.parse(past.ends_at) + 86400001,
    ),
  ).toBeNull();
  expect(accountReminderBlock([future], profile, now)).toBeNull();
});
test("weather descriptions distinguish missing codes from clear skies", () => {
  expect(weatherDescription(null)).toBe("Conditions unavailable");
  expect(weatherDescription(0)).toBe("Clear");
  expect(weatherDescription(2)).toBe("Partly cloudy");
  expect(weatherDescription(61)).toBe("Light rain");
  expect(weatherDescription(63)).toBe("Moderate rain");
  expect(weatherDescription(65)).toBe("Heavy rain");
  expect(weatherDescription(95)).toBe("Thunderstorms");
});

test("multiple reminder channels treat an explicit empty selection as off and surface partial delivery", () => {
  const both = {
    reminder_channel: "email",
    reminder_channels: ["email", "push"],
    reminders_paused: false,
  };
  expect(reminderBlock(past, both, "enable", now)).toBeNull();
  expect(
    reminderBlock(past, { ...both, reminder_channels: [] }, "enable", now),
  ).toBe("no_channel");
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
