import { z } from "zod";
import { PRACTICE_WINDOWS } from "./domain.ts";

// Monday-first indexes; derive eligibility from the Madison calendar date.
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const weekdaySchema = z
  .array(z.number().int().min(0).max(6))
  .min(1, "Choose at least one day.")
  .max(7)
  .refine(
    (days) => new Set(days).size === days.length,
    "Choose each day only once.",
  )
  .transform((days) => [...days].sort())
  .default(ALL_WEEKDAYS);

const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a valid time.");
export const weekPeriodSchema = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().trim().min(1, "Enter a name.").max(40),
    start: clockTime,
    end: clockTime,
    enabled: z.boolean(),
    days: weekdaySchema,
  })
  .strict()
  .refine((p) => p.end > p.start, {
    message: "End time must be after start time on the same day.",
    path: ["end"],
  });
export const weekPeriodsSchema = z
  .array(weekPeriodSchema)
  .max(12)
  .refine(
    (periods) => new Set(periods.map((p) => p.id)).size === periods.length,
    "Period IDs must be unique.",
  );
export type WeekPeriod = z.infer<typeof weekPeriodSchema>;
export const DEFAULT_WEEK_PERIODS: WeekPeriod[] = PRACTICE_WINDOWS.map((p) => ({
  ...p,
  enabled: true,
  days: [...ALL_WEEKDAYS],
}));
export const sortPeriods = (periods: WeekPeriod[]) =>
  [...periods].sort(
    (a, b) =>
      a.start.localeCompare(b.start) ||
      a.end.localeCompare(b.end) ||
      a.label.localeCompare(b.label),
  );

export function periodDaysLabel(days: number[]) {
  const ordered = [...days].sort();
  if (ordered.length === 7) return "Every day";
  if (ordered.join() === "0,1,2,3,4") return "Weekdays";
  if (ordered.join() === "5,6") return "Weekends";
  return ordered.map((day) => WEEKDAY_NAMES[day].slice(0, 3)).join(", ");
}
export function periodsForDay(periods: WeekPeriod[], date: string) {
  const weekday = (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
  return sortPeriods(
    periods.filter((period) => period.enabled && period.days.includes(weekday)),
  );
}
// Preserve the original response shape for installed clients whose schema is strict.
export function legacyPeriods(periods: WeekPeriod[]) {
  return periods.map(({ days: _days, ...period }) => period);
}
