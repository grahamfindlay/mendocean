import { z } from "zod";

export const TIMEZONE = "America/Chicago";
export const LOCATION = {
  latitude: 43.0814,
  longitude: -89.3829,
  name: "James Madison Park",
};
export const HEURISTIC_VERSION = "hannah-1.0.0";
export type WindStatus =
  "favorable" | "caution" | "unfavorable" | "unavailable";
export const STATUS_LABELS: Record<WindStatus, string> = {
  favorable: "Favorable wind",
  caution: "Use caution",
  unfavorable: "Unfavorable wind",
  unavailable: "Assessment unavailable",
};
export const COACH_NAMES = [
  "Charlie",
  "Rose",
  "Heather",
  "Taylan",
  "Alicia",
  "Helena",
  "Sam",
  "Camille",
  "Lexi",
];
export const BOAT_CLASSES = [
  "1x",
  "2x",
  "2−",
  "2+",
  "4x",
  "4−",
  "4+",
  "8+",
] as const;
export const ROUTES = ["east", "west", "both", "unknown"] as const;
export const RATINGS = ["Glass", "Good", "Fine", "Poor", "Forced off"] as const;
/**
 * The intervals people actually row, summarized on each Week card.
 *
 * A calendar-day summary answers a question nobody asks: an afternoon that
 * blows out the lake reads unfavorable all day even when dawn is glass. Fixed
 * and identical every day for now; real BHC practice times are a later
 * refinement, not a prerequisite. Both bounds avoid the DST-changed hour, so
 * `chicagoToISO` resolves them on every calendar day.
 */
export const PRACTICE_WINDOWS = [
  { id: "morning", label: "Morning", start: "05:30", end: "07:30" },
  { id: "evening", label: "Evening", start: "18:00", end: "20:00" },
] as const;
export type PracticeWindow = (typeof PRACTICE_WINDOWS)[number];

export function windZone(direction: number): 1 | 2 | 3 {
  const d = ((direction % 360) + 360) % 360;
  return d >= 258.75 || d < 11.25 ? 1 : d < 78.75 ? 3 : 2;
}
export function windStatus(
  speed: number | null | undefined,
  direction: number | null | undefined,
): WindStatus {
  if (
    speed == null ||
    direction == null ||
    !Number.isFinite(speed) ||
    !Number.isFinite(direction) ||
    speed < 0
  )
    return "unavailable";
  const zone = windZone(direction);
  if (zone === 1) return speed < 5 ? "favorable" : "unfavorable";
  if (zone === 3)
    return speed < 5 ? "favorable" : speed < 10 ? "caution" : "unfavorable";
  return speed < 10 ? "favorable" : speed < 15 ? "caution" : "unfavorable";
}
export function directionLabel(direction: number | null): string {
  if (direction == null || !Number.isFinite(direction)) return "Unknown";
  return [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ][Math.round((((direction % 360) + 360) % 360) / 22.5) % 16];
}
export function circularMean(degrees: number[]): number | null {
  if (!degrees.length) return null;
  const x = degrees.reduce((sum, d) => sum + Math.cos((d * Math.PI) / 180), 0);
  const y = degrees.reduce((sum, d) => sum + Math.sin((d * Math.PI) / 180), 0);
  if (Math.hypot(x, y) < 1e-8) return null;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
export function boatSize(boat: string): number | null {
  return BOAT_CLASSES.includes(boat as (typeof BOAT_CLASSES)[number])
    ? Number(boat[0])
    : null;
}
export function boatExtremes(boats: string[]): {
  smallest: number | null;
  largest: number | null;
} {
  const sizes = boats.map(boatSize).filter((n): n is number => n !== null);
  return sizes.length
    ? { smallest: Math.min(...sizes), largest: Math.max(...sizes) }
    : { smallest: null, largest: null };
}
export function localDateTime(iso = new Date().toISOString()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}`;
}
// Resolve local wall time without depending on the device timezone. Reject ambiguous/nonexistent DST times.
export function chicagoToISO(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error("Choose a valid date and time.");
  const naive = Date.parse(local + ":00Z");
  const candidates = [5, 6]
    .map((h) => new Date(naive + h * 3600000).toISOString())
    .filter((iso) => localDateTime(iso) === local);
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "This time occurs twice when clocks change. Choose a time outside that hour."
        : "This time does not exist when clocks change. Choose another time.",
    );
  return candidates[0];
}
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

export const reportSchema = z
  .object({
    submission_id: z.string().uuid(),
    expected_version: z.number().int().min(0),
    outcome: z.enum(["rowed", "stayed_ashore", "did_not_attend"]),
    scope: z.enum(["personal", "whole_outing"]).default("personal"),
    reason: z
      .enum(["wind_waves", "other_weather", "non_weather", "unknown"])
      .nullable(),
    rating: z.number().int().min(1).max(5).nullable(),
    route: z.enum(ROUTES),
    boat_class: z.enum(BOAT_CLASSES).nullable(),
    launched_boats: z.array(z.enum(BOAT_CLASSES)).max(8),
    coach_state: z.enum(["uncoached", "known", "unknown"]),
    coach_ids: z.array(z.string().uuid()).max(30),
    coach_count: z.number().int().min(0).max(30).nullable(),
    smallest_boat: z
      .number()
      .int()
      .refine((n) => [1, 2, 4, 8].includes(n))
      .nullable(),
    largest_boat: z
      .number()
      .int()
      .refine((n) => [1, 2, 4, 8].includes(n))
      .nullable(),
    actual_start: z.string().datetime().nullable(),
    actual_end: z.string().datetime().nullable(),
    notes: z.string().trim().max(2000),
    segments: z
      .array(
        z.object({
          route: z.enum(["east", "west"]),
          rating: z.number().int().min(1).max(5),
        }),
      )
      .max(2)
      .default([]),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (v.outcome === "rowed" && v.rating == null)
      issue("Choose a water rating.");
    if (
      v.outcome !== "rowed" &&
      (v.rating !== null ||
        v.segments.length ||
        v.launched_boats.length ||
        v.boat_class !== null ||
        v.smallest_boat !== null ||
        v.largest_boat !== null)
    )
      issue(
        "A non-rowing report cannot include observed water or launched boats.",
      );
    if (v.outcome === "stayed_ashore" && v.reason === null)
      issue("Choose why you stayed ashore, or Unknown.");
    if (
      v.coach_state === "uncoached" &&
      (v.coach_ids.length || v.coach_count !== 0)
    )
      issue("An uncoached row must have zero coaches.");
    if (new Set(v.coach_ids).size !== v.coach_ids.length)
      issue("Each coach may only appear once.");
    if (v.coach_ids.length && v.coach_count !== v.coach_ids.length)
      issue("Coach count must match selected coaches.");
    if (v.smallest_boat && v.largest_boat && v.smallest_boat > v.largest_boat)
      issue("Smallest boat cannot be larger than biggest boat.");
    if (v.actual_start && v.actual_end && v.actual_start >= v.actual_end)
      issue("End time must be after start time.");
    if (new Set(v.segments.map((s) => s.route)).size !== v.segments.length)
      issue("Rate each route only once.");
  });
export type ReportInput = z.infer<typeof reportSchema>;
export const outingSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["official", "independent"]),
    title: z.string().trim().min(1).max(120),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    planned_boat: z.enum(BOAT_CLASSES).nullable().default(null),
    reminder: z.boolean().default(false),
  })
  .refine(
    (v) => Date.parse(v.ends_at) > Date.parse(v.starts_at),
    "End time must be after start time.",
  );
export type OutingInput = z.infer<typeof outingSchema>;
export interface Outing extends OutingInput {
  owner_id: string | null;
  bhc_practice_id: number | null;
  attendance?: string;
  attendance_deadline?: string | null;
  skipped?: boolean;
  reminder_state?: {
    due_at: string | null;
    sent_at: string | null;
    channels?: {
      channel: "email" | "push";
      sent_at: string | null;
      error: string | null;
      status: "pending" | "retrying" | "failed" | "sent" | "not_requested";
      devices_sent: number;
    }[];
  };
  version: number;
  reports?: Report[];
  planned_coaches?: string[];
  planned_boats?: string[];
}
export interface Report extends ReportInput {
  id: string;
  outing_id: string;
  user_id: string;
  version: number;
  created_at: string;
}
export interface Coach {
  id: string;
  name: string;
}
export interface WeatherHour {
  interval_minutes?: 15 | 60;
  time: string;
  wind: number | null;
  direction: number | null;
  gust: number | null;
  temperature: number | null;
  precipitation: number | null;
  probability: number | null;
  visibility: number | null;
  code: number | null;
}
export interface Forecast {
  fetched_at: string;
  provider: string;
  model_version: string;
  hours: WeatherHour[];
  current: WeatherHour | null;
  quarter_hours?: WeatherHour[];
  resolution_note?: string;
  source_kind: "modeled" | "fixture";
  evidence?: { outings: number; ratings: number[] };
}
export function weatherFreshness(
  fetchedAt: string,
  now = Date.now(),
): "fresh" | "stale" | "expired" {
  const age = now - Date.parse(fetchedAt);
  if (!Number.isFinite(age)) return "expired";
  return age > 6 * 3600000 ? "expired" : age > 2 * 3600000 ? "stale" : "fresh";
}
