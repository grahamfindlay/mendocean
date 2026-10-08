export interface ObservationHealth {
  sources: {
    source: string;
    enabled_at: string;
    last_success: string | null;
    latest_observed_at: string | null;
    failures: number;
    last_error: string | null;
    trial_ends_at: string | null;
    review_due: boolean;
  }[];
  database_bytes: number;
  storage_bytes: number;
  archive_days: number;
  unenriched_reports: number;
}
export interface Operations {
  weather_observations?: ObservationHealth;
  started_at: string;
  last_weather: string | null;
  last_tick_started_at: string | null;
  last_tick_completed_at: string | null;
  overdue_jobs: number;
  retries_24h: number;
  failed_jobs_24h: number;
  api_failures_15m: number;
  api_affected_users_15m: number;
  bhc_problems: number;
  reminder_problems: number;
  recent_events: {
    at: string;
    user_id: string | null;
    request_id: string | null;
    operation: string;
    outcome: string;
  }[];
}
export interface ActivityUser {
  id: string;
  display_name: string;
  email: string | null;
  role: string;
  approved: boolean;
  invited_at: string;
  first_observed_at: string | null;
  last_observed_at: string | null;
  report_count: number;
  reports_created: number;
  last_report_at: string | null;
  bhc_connected: boolean;
  last_sync: string | null;
  bhc_problem: boolean;
  reminder_channels: string[];
  reminders_paused: boolean;
  reminder_problem: boolean;
}
export interface ActivitySummary {
  started_at: string;
  days: number;
  users: ActivityUser[];
  summary: WeekSummary;
}
export interface ActivityEvent {
  id: number;
  at: string;
  event: string;
  details: Record<string, unknown>;
}
export interface WeekSummary {
  started_at: string;
  start: string;
  end: string;
  active_users: number;
  returning_users: number;
  reports_created: number;
  reports_edited: number;
  reports_deleted: number;
  contributors: number;
  bhc_connected: number;
}
export const HEALTH_LIMITS = {
  weatherMinutes: 45,
  tickMinutes: 15,
  apiFailures: 5,
  affectedUsers: 2,
};
export function readiness(operations: Operations, now = Date.now()) {
  const old = (value: string | null, minutes: number) =>
    !value ||
    !Number.isFinite(Date.parse(value)) ||
    now - Date.parse(value) > minutes * 60000;
  const reasons: string[] = [];
  if (old(operations.last_weather, HEALTH_LIMITS.weatherMinutes))
    reasons.push("weather_stale");
  if (old(operations.last_tick_completed_at, HEALTH_LIMITS.tickMinutes))
    reasons.push("dispatcher_stalled");
  if (operations.overdue_jobs > 0) reasons.push("queue_stalled");
  if (
    operations.api_failures_15m >= HEALTH_LIMITS.apiFailures &&
    operations.api_affected_users_15m >= HEALTH_LIMITS.affectedUsers
  )
    reasons.push("api_failures");
  const observations = operations.weather_observations;
  if (observations) {
    if (observations.database_bytes >= 350e6) reasons.push("database_capacity");
    if (observations.storage_bytes >= 700e6) reasons.push("archive_capacity");
    for (const source of observations.sources) {
      if (
        source.review_due ||
        (source.trial_ends_at && Date.parse(source.trial_ends_at) <= now)
      )
        continue;
      if (now - Date.parse(source.enabled_at) < 3600000) continue;
      if (
        source.failures >= 3 ||
        old(source.last_success, 60) ||
        old(source.latest_observed_at, source.source === "buoy" ? 30 : 120)
      )
        reasons.push(`observations_${source.source}_stale`);
    }
  }
  return { status: reasons.length ? "unhealthy" : "ready", reasons };
}
