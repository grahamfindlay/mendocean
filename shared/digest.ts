import { chicagoToISO } from "./domain.ts";
import type { Operations, WeekSummary } from "./monitoring.ts";
export function localClock(now: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    hour: Number(parts.hour),
  };
}
export function digestWindow(now: number) {
  const clock = localClock(now);
  const day = new Date(`${clock.date}T12:00:00Z`);
  const distance = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - distance);
  const endDate = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() - 7);
  const startDate = day.toISOString().slice(0, 10);
  return {
    week: startDate,
    start: chicagoToISO(`${startDate}T00:00`),
    end: chicagoToISO(`${endDate}T00:00`),
  };
}
export function digestDue(now: number) {
  const clock = localClock(now);
  return clock.weekday === "Mon" && clock.hour === 8;
}
export function digestText(
  summary: WeekSummary,
  previous: WeekSummary,
  operations: Operations,
  analytics: { forecast_views: number; errors: number } | null,
  site: string,
  analyticsSite = "https://us.posthog.com",
) {
  return [
    `Mendocean owner report for the week starting ${localClock(Date.parse(summary.start)).date}`,
    `Activity collection began ${localClock(Date.parse(summary.started_at)).date}. Owner activity excluded from usage and report counts.`,
    `Observed active users: ${summary.active_users} (previous week: ${previous.active_users}). Returning from the previous week: ${summary.returning_users}.`,
    `New reports: ${summary.reports_created} (previous week: ${previous.reports_created}); contributors: ${summary.contributors}. Edits: ${summary.reports_edited}; deletes: ${summary.reports_deleted}.`,
    `BHC connections made: ${summary.bhc_connected}.`,
    analytics
      ? `Observed forecast views: ${analytics.forecast_views}. Browser exceptions: ${analytics.errors}.`
      : "PostHog summary unavailable or not configured; no zero values inferred.",
    `Current operations: overdue jobs ${operations.overdue_jobs}; job retries ${operations.retries_24h} and terminal failures ${operations.failed_jobs_24h} in 24 hours; BHC problems ${operations.bhc_problems}; reminder problems ${operations.reminder_problems}.`,
    `Last weather: ${operations.last_weather || "not collected"}. Last completed dispatch: ${operations.last_tick_completed_at || "not observed"}.`,
    ...(operations.weather_observations
      ? [
          `Measured weather: ${operations.weather_observations.sources.map((s) => `${s.source}: latest ${s.latest_observed_at || "missing"}, consecutive failures ${s.failures}${s.review_due ? "; VC trial stopped—review required" : ""}`).join(". ")}.`,
          `Database ${(operations.weather_observations.database_bytes / 1e6).toFixed(1)} MB; file storage ${(operations.weather_observations.storage_bytes / 1e6).toFixed(1)} MB. Reports awaiting measured-weather association: ${operations.weather_observations.unenriched_reports}.`,
        ]
      : []),
    "Offline use may be missing. Reminder provider acceptance does not establish inbox placement or device display.",
    `Owner dashboard: ${site}/?account=1`,
    `Analytics: ${analyticsSite}/`,
    "Backend logs: https://supabase.com/dashboard",
    "Incidents: https://uptime.betterstack.com/",
  ].join("\n\n");
}
