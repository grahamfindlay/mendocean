import { Link } from "react-router-dom";
import {
  readiness,
  type ActivitySummary,
  type Operations,
} from "../shared/monitoring";
import { adminStamp, useAdminData, type AdminHealth } from "./adminData";

function ServiceStatus({ operations }: { operations: Operations }) {
  const status = readiness(operations);
  return (
    <p className={status.status === "ready" ? "notice" : "alert"}>
      Service{" "}
      {status.status === "ready"
        ? "ready"
        : `needs attention: ${status.reasons.map((r) => r.replaceAll("_", " ")).join(", ")}`}
    </p>
  );
}
export function AdminOverview() {
  const activity = useAdminData<ActivitySummary>("admin/activity?days=7");
  const operations = useAdminData<Operations>("admin/operations");
  const busy = activity.busy || operations.busy;
  return (
    <>
      <div className="admin-section-heading">
        <h2>Last 7 days</h2>
        <button
          className="button subtle"
          disabled={busy}
          onClick={() => {
            void activity.refresh();
            void operations.refresh();
          }}
        >
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      {(activity.error || operations.error) && (
        <p className="alert" role="alert">
          {activity.error || operations.error}
        </p>
      )}
      <div className="admin-summary-grid">
        {[
          ["Observed active users", activity.data?.summary.active_users],
          ["Report contributors", activity.data?.summary.contributors],
          ["New reports", activity.data?.summary.reports_created],
          [
            "Approved accounts",
            activity.data?.users.filter((u) => u.approved).length,
          ],
        ].map(([label, value]) => (
          <div className="admin-stat" key={label}>
            <strong>{value ?? "—"}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="help">
        Activity totals exclude the owner. Offline use may be missing. Updated{" "}
        {adminStamp(activity.updated)}.
      </p>
      <section className="admin-panel">
        <h2>Service status</h2>
        {operations.data ? (
          <>
            <ServiceStatus operations={operations.data} />
            <dl className="admin-health">
              <dt>BHC connections needing attention</dt>
              <dd>{operations.data.bhc_problems}</dd>
              <dt>Reminder problems</dt>
              <dd>{operations.data.reminder_problems}</dd>
              <dt>Terminal job failures in 24 hours</dt>
              <dd>{operations.data.failed_jobs_24h}</dd>
            </dl>
          </>
        ) : (
          <p>
            {operations.busy
              ? "Loading service status…"
              : "Service status is unavailable."}
          </p>
        )}
        <Link to="/admin/operations">View operations</Link>
      </section>
      <div className="admin-quick-links">
        <Link to="/admin/accounts">
          <h2>Accounts & activity</h2>
          <p>Invite users, review reports, and inspect account history.</p>
        </Link>
        <Link to="/admin/reconcile">
          <h2>Reconcile duplicates</h2>
          <p>Compare records and merge a duplicate into the shared event.</p>
        </Link>
        <Link to="/admin/intervals">
          <h2>Correct actual times</h2>
          <p>Review scheduled and actual times before saving a correction.</p>
        </Link>
        <Link to="/admin/models">
          <h2>Models</h2>
          <p>Review performance and manage model publication.</p>
        </Link>
      </div>
    </>
  );
}
export function AdminOperations() {
  const operations = useAdminData<Operations>("admin/operations");
  const health = useAdminData<AdminHealth>("health");
  const busy = operations.busy || health.busy;
  return (
    <>
      <div className="admin-section-heading">
        <p className="help">Updated {adminStamp(operations.updated)}</p>
        <button
          className="button subtle"
          disabled={busy}
          onClick={() => {
            void operations.refresh();
            void health.refresh();
          }}
        >
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      {(operations.error || health.error) && (
        <p className="alert" role="alert">
          {operations.error || health.error}
        </p>
      )}
      {operations.data && (
        <section className="admin-panel">
          <h2>Service readiness</h2>
          <ServiceStatus operations={operations.data} />
          <dl className="admin-health">
            <dt>Last weather collection</dt>
            <dd>{adminStamp(operations.data.last_weather)}</dd>
            <dt>Last completed dispatch</dt>
            <dd>{adminStamp(operations.data.last_tick_completed_at)}</dd>
            <dt>Overdue active jobs</dt>
            <dd>{operations.data.overdue_jobs}</dd>
            <dt>Retries / terminal job failures in 24 hours</dt>
            <dd>
              {operations.data.retries_24h} / {operations.data.failed_jobs_24h}
            </dd>
            <dt>API failures / affected users in 15 minutes</dt>
            <dd>
              {operations.data.api_failures_15m} /{" "}
              {operations.data.api_affected_users_15m}
            </dd>
            <dt>BHC / reminder problems</dt>
            <dd>
              {operations.data.bhc_problems} /{" "}
              {operations.data.reminder_problems}
            </dd>
          </dl>
        </section>
      )}
      {operations.data?.weather_observations && (
        <section className="admin-panel">
          <h2>Measured weather collection</h2>
          {operations.data.weather_observations.sources.map((source) => (
            <div key={source.source}>
              <h3>
                {source.source === "buoy"
                  ? "Mendota buoy"
                  : source.source === "iem_msn"
                    ? "MSN airport · IEM"
                    : "James Madison Park · Visual Crossing"}
              </h3>
              <p>
                Last successful collection: {adminStamp(source.last_success)}.
                Latest measurement: {adminStamp(source.latest_observed_at)}.
              </p>
              {source.failures > 0 && (
                <p className="alert">
                  {source.failures} consecutive collection failures ·{" "}
                  {source.last_error}
                </p>
              )}
              {source.trial_ends_at && (
                <p className={source.review_due ? "alert" : "help"}>
                  {source.review_due
                    ? "VC trial completed. Collection stopped pending review."
                    : `VC trial review due ${adminStamp(source.trial_ends_at)}.`}
                </p>
              )}
            </div>
          ))}
          {!operations.data.weather_observations.sources.some(
            (s) => s.source === "vc_jmp",
          ) && (
            <p className="help">
              VC comparison has not started. A server API key is required.
            </p>
          )}
          <p className="help">
            Reports awaiting measured weather:{" "}
            {operations.data.weather_observations.unenriched_reports}. Archived
            observation days:{" "}
            {operations.data.weather_observations.archive_days}.
          </p>
        </section>
      )}
      {health.data && (
        <section className="admin-panel">
          <h2>Storage & jobs</h2>
          <p>
            Database {(health.data.database_bytes / 1e6).toFixed(1)} / 500 MB ·
            Weather {(health.data.weather_storage_bytes / 1e6).toFixed(1)} /
            1000 MB
          </p>
          {[
            [health.data.database_bytes, 500e6, "Database"],
            [health.data.weather_storage_bytes, 1e9, "Weather storage"],
          ].map(([used, total, label]) =>
            Number(used) / Number(total) >= 0.7 ? (
              <p className="alert" key={label}>
                {label} is at {Math.round((Number(used) / Number(total)) * 100)}
                % of the pilot allowance.{" "}
                {Number(used) / Number(total) >= 0.85
                  ? "Review capacity before inviting more users."
                  : "Check the provider dashboard."}
              </p>
            ) : null,
          )}
          <p className="help">
            Failed jobs: {health.data.failed_jobs}. Last weather:{" "}
            {adminStamp(health.data.last_weather)}.
          </p>
        </section>
      )}
      {operations.data && (
        <section className="admin-panel">
          <h2>Recent job and API outcomes</h2>
          {operations.data.recent_events.length ? (
            <ul className="admin-event-list">
              {operations.data.recent_events.map((e, i) => (
                <li key={i}>
                  {adminStamp(e.at)} · {e.operation} · {e.outcome}
                  {e.request_id && <small>Request {e.request_id}</small>}
                </li>
              ))}
            </ul>
          ) : (
            <p>No recent outcomes.</p>
          )}
        </section>
      )}
      <p className="admin-monitor-links">
        <a
          href={
            import.meta.env.VITE_POSTHOG_HOST === "https://eu.i.posthog.com"
              ? "https://eu.posthog.com/"
              : "https://us.posthog.com/"
          }
          target="_blank"
          rel="noreferrer"
        >
          Open PostHog
        </a>
        <a
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noreferrer"
        >
          Open Supabase logs
        </a>
        <a
          href="https://uptime.betterstack.com/"
          target="_blank"
          rel="noreferrer"
        >
          Open service monitor
        </a>
      </p>
    </>
  );
}
