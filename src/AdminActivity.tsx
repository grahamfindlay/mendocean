import { useEffect, useRef, useState } from "react";
import { api } from "./client";
import {
  readiness,
  type ActivityEvent,
  type ActivitySummary,
  type Operations,
} from "../shared/monitoring";
import { formatDate, formatTime } from "../shared/domain";
const stamp = (value: string | null) =>
  value ? `${formatDate(value)} ${formatTime(value)}` : "Not observed";
export default function AdminActivity() {
  const [days, setDays] = useState(7);
  const [activity, setActivity] = useState<ActivitySummary>();
  const [operations, setOperations] = useState<Operations>();
  const [selected, setSelected] = useState("");
  const selection = useRef(selected);
  selection.current = selected;
  const refreshGeneration = useRef(0);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshed, setRefreshed] = useState<string | null>(null);
  const refresh = async () => {
    const generation = ++refreshGeneration.current;
    setBusy(true);
    setError("");
    try {
      const [a, o] = await Promise.all([
        api<ActivitySummary>(`admin/activity?days=${days}`),
        api<Operations>("admin/operations"),
      ]);
      if (generation !== refreshGeneration.current) return;
      if (
        !Array.isArray(a.users) ||
        !a.summary ||
        !Array.isArray(o.recent_events)
      )
        throw new Error("Invalid monitoring response");
      setActivity(a);
      setOperations(o);
      setRefreshed(new Date().toISOString());
    } catch {
      if (generation === refreshGeneration.current)
        setError("Monitoring data could not be loaded. Try refreshing.");
    } finally {
      if (generation === refreshGeneration.current) setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, [days]);
  useEffect(() => {
    setEvents([]);
    setMore(false);
    if (!selected) return;
    let alive = true;
    void api<{ events: ActivityEvent[] }>(
      `admin/timeline?user=${encodeURIComponent(selected)}`,
    )
      .then((data) => {
        if (alive) {
          setEvents(data.events);
          setMore(data.events.length === 50);
        }
      })
      .catch(() => {
        if (alive) setError("Activity history could not be loaded.");
      });
    return () => {
      alive = false;
    };
  }, [selected]);
  const loadMore = async () => {
    setBusy(true);
    const user = selected;
    try {
      const data = await api<{ events: ActivityEvent[] }>(
        `admin/timeline?user=${encodeURIComponent(user)}&before=${events.at(-1)?.id}`,
      );
      if (selection.current !== user) return;
      setEvents((previous) => [...previous, ...data.events]);
      setMore(data.events.length === 50);
    } catch {
      setError("Activity history could not be loaded.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-activity" aria-label="Activity and operations">
      <h3>Activity</h3>
      <div className="admin-monitor-controls">
        <label>
          Period
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
          </select>
        </label>
        <button
          className="button subtle"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      <p className="help">
        Updated {stamp(refreshed)}. Last observed activity includes account
        visits and confirmed application changes; offline use may be missing.
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {activity && (
        <>
          <p className="help">
            Collection began {stamp(activity.started_at)}.{" "}
            {activity.users.filter((u) => u.approved).length} approved accounts.
          </p>
          <p>
            {activity.summary.active_users} observed active users ·{" "}
            {activity.summary.contributors} report contributors ·{" "}
            {activity.summary.reports_created} new reports in {days} days. Owner
            excluded.
          </p>
          <div className="admin-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Last observed activity</th>
                  <th>Reports</th>
                  <th>BHC</th>
                  <th>Reminders</th>
                </tr>
              </thead>
              <tbody>
                {activity.users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setSelected(u.id)}
                      >
                        {u.display_name || `Account ${u.id.slice(0, 8)}`}
                      </button>
                      {u.role === "admin" && " · owner"}
                      {!u.approved && " · unapproved"}
                    </td>
                    <td>
                      {stamp(u.last_observed_at)}
                      <small>First: {stamp(u.first_observed_at)}</small>
                    </td>
                    <td>
                      {u.report_count} total · {u.reports_created} new
                      <small>Last: {stamp(u.last_report_at)}</small>
                    </td>
                    <td>
                      {u.bhc_connected
                        ? u.bhc_problem
                          ? "Needs attention"
                          : `Synced ${stamp(u.last_sync)}`
                        : "Not connected"}
                    </td>
                    <td>
                      {u.reminders_paused
                        ? "Paused"
                        : u.reminder_channels.join(" + ") || "Off"}
                      {u.reminder_problem && " · Needs attention"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!activity.users.length && <p>No accounts yet.</p>}
        </>
      )}
      {selected && (
        <div>
          <h4>Observed activity history</h4>
          <label>
            Account ID for PostHog search
            <input
              readOnly
              value={selected}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <p className="help">
            {activity?.users.find((u) => u.id === selected)?.display_name ||
              selected.slice(0, 8)}
          </p>
          {events.length ? (
            <ul>
              {events.map((e) => (
                <li key={e.id}>
                  {stamp(e.at)} · {e.event.replaceAll("_", " ")}
                  {typeof e.details.operation === "string" &&
                    ` · ${e.details.operation}`}
                  {typeof e.details.request_id === "string" && (
                    <small>Request {e.details.request_id}</small>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No observed activity recorded.</p>
          )}
          {more && (
            <button
              className="button subtle"
              disabled={busy}
              onClick={() => void loadMore()}
            >
              Load earlier activity
            </button>
          )}
        </div>
      )}
      <h3>Operations</h3>
      {operations && (
        <>
          <p
            className={
              readiness(operations).status === "ready" ? "notice" : "alert"
            }
          >
            Service{" "}
            {readiness(operations).status === "ready"
              ? "ready"
              : `needs attention: ${readiness(operations)
                  .reasons.map((r) => r.replaceAll("_", " "))
                  .join(", ")}`}
          </p>
          <dl className="admin-health">
            <dt>Last weather collection</dt>
            <dd>{stamp(operations.last_weather)}</dd>
            <dt>Last completed dispatch</dt>
            <dd>{stamp(operations.last_tick_completed_at)}</dd>
            <dt>Overdue active jobs</dt>
            <dd>{operations.overdue_jobs}</dd>
            <dt>Retries / terminal job failures in 24 hours</dt>
            <dd>
              {operations.retries_24h} / {operations.failed_jobs_24h}
            </dd>
            <dt>API failures / affected users in 15 minutes</dt>
            <dd>
              {operations.api_failures_15m} /{" "}
              {operations.api_affected_users_15m}
            </dd>
            <dt>BHC / reminder problems</dt>
            <dd>
              {operations.bhc_problems} / {operations.reminder_problems}
            </dd>
          </dl>
          <details>
            <summary>Recent job and API outcomes</summary>
            {operations.recent_events.length ? (
              <ul>
                {operations.recent_events.map((e, i) => (
                  <li key={i}>
                    {stamp(e.at)} · {e.operation} · {e.outcome}
                    {e.request_id && <small> · Request {e.request_id}</small>}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No recent outcomes.</p>
            )}
          </details>
        </>
      )}
      <p>
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
        </a>{" "}
        ·{" "}
        <a
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noreferrer"
        >
          Open Supabase logs
        </a>{" "}
        ·{" "}
        <a
          href="https://uptime.betterstack.com/"
          target="_blank"
          rel="noreferrer"
        >
          Open service monitor
        </a>
      </p>
    </section>
  );
}
