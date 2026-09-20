import { z } from "zod";
import { PRACTICE_WINDOWS } from "./domain.ts";

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
}));
export const sortPeriods = (periods: WeekPeriod[]) =>
  [...periods].sort(
    (a, b) =>
      a.start.localeCompare(b.start) ||
      a.end.localeCompare(b.end) ||
      a.label.localeCompare(b.label),
  );
