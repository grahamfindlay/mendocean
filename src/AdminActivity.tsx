import { useEffect, useRef, useState } from "react";
import { api } from "./client";
import type {
  ActivityEvent,
  ActivitySummary,
  ActivityUser,
} from "../shared/monitoring";
import { adminStamp, useAdminAction, useAdminData } from "./adminData";
import { AdminActionStatus } from "./AdminTools";

const accountName = (user: ActivityUser) =>
  user.display_name.trim() || user.email || `Account ${user.id.slice(0, 8)}`;

function InviteUser({ onInvited }: { onInvited: () => Promise<void> }) {
  const action = useAdminAction();
  const [email, setEmail] = useState("");
  return (
    <section className="admin-panel">
      <h2>Invite a pilot user</h2>
      <p className="help">
        Create an approved account. The person can then request a sign-in code
        using this email address.
      </p>
      <form
        className="admin-invite-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await api("invite", { email });
            setEmail("");
            action.setMessage(
              "Account created. The person can request a sign-in code.",
            );
            await onInvited();
          });
        }}
      >
        <label>
          Email
          <input
            type="email"
            name="email"
            required
            value={email}
            disabled={action.busy}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button className="button subtle" disabled={action.busy}>
          {action.busy ? "Creating…" : "Create invited account"}
        </button>
      </form>
      <AdminActionStatus {...action} />
    </section>
  );
}
function AccountHistory({
  user,
  onClose,
}: {
  user: ActivityUser;
  onClose: () => void;
}) {
  const timeline = useAdminData<{ events: ActivityEvent[] }>(
    `admin/timeline?user=${encodeURIComponent(user.id)}`,
  );
  const action = useAdminAction();
  const [earlier, setEarlier] = useState<ActivityEvent[]>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const events = [...(timeline.data?.events || []), ...earlier];
  return (
    <section className="admin-panel" aria-label="Observed activity history">
      <div className="admin-section-heading">
        <h2>Observed activity history</h2>
        <button className="button subtle" onClick={onClose}>
          Close history
        </button>
      </div>
      <h3 className="admin-account-name">{accountName(user)}</h3>
      {user.email && user.display_name.trim() && (
        <p className="help admin-account-email">{user.email}</p>
      )}
      <label>
        Account ID for PostHog search
        <input
          readOnly
          value={user.id}
          onFocus={(e) => e.currentTarget.select()}
        />
      </label>
      {timeline.busy && <p role="status">Loading activity history…</p>}
      {timeline.error && (
        <>
          <p className="alert" role="alert">
            {timeline.error}
          </p>
          <button
            className="button subtle"
            onClick={() => void timeline.refresh()}
          >
            Retry history
          </button>
        </>
      )}
      {events.length ? (
        <ul className="admin-event-list">
          {events.map((e) => (
            <li key={e.id}>
              {adminStamp(e.at)} · {e.event.replaceAll("_", " ")}
              {typeof e.details.operation === "string" &&
                ` · ${e.details.operation}`}
              {typeof e.details.request_id === "string" && (
                <small>Request {e.details.request_id}</small>
              )}
            </li>
          ))}
        </ul>
      ) : (
        timeline.data && <p>No observed activity recorded.</p>
      )}
      {(more ?? timeline.data?.events.length === 50) && (
        <button
          className="button subtle"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const data = await api<{ events: ActivityEvent[] }>(
                `admin/timeline?user=${encodeURIComponent(user.id)}&before=${events.at(-1)?.id}`,
              );
              if (!alive.current) return;
              setEarlier((previous) => [...previous, ...data.events]);
              setMore(data.events.length === 50);
            })
          }
        >
          {action.busy ? "Loading…" : "Load earlier activity"}
        </button>
      )}
      <AdminActionStatus {...action} />
    </section>
  );
}
export default function AdminActivity() {
  const [days, setDays] = useState(7);
  const activity = useAdminData<ActivitySummary>(`admin/activity?days=${days}`);
  const [selected, setSelected] = useState("");
  const user = activity.data?.users.find((u) => u.id === selected);
  return (
    <>
      <InviteUser onInvited={activity.refresh} />
      <section aria-label="Account activity">
        <div className="admin-section-heading">
          <h2>Observed activity</h2>
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
              disabled={activity.busy}
              onClick={() => void activity.refresh()}
            >
              {activity.busy ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        <p className="help">
          Updated {adminStamp(activity.updated)}. Last observed activity
          includes account visits and confirmed application changes; offline use
          may be missing.
        </p>
        {activity.error && (
          <p className="alert" role="alert">
            {activity.error}
          </p>
        )}
        {activity.data && (
          <>
            <p className="help">
              Collection began {adminStamp(activity.data.started_at)}.{" "}
              {activity.data.users.filter((u) => u.approved).length} approved
              accounts.
            </p>
            <p>
              {activity.data.summary.active_users} observed active users ·{" "}
              {activity.data.summary.contributors} report contributors ·{" "}
              {activity.data.summary.reports_created} new reports in {days}{" "}
              days. Owner excluded.
            </p>
            <div
              className="admin-table-scroll"
              role="region"
              aria-label="Pilot accounts"
              tabIndex={0}
            >
              <table className="admin-accounts-table">
                <caption className="visually-hidden">
                  Pilot accounts and their observed activity over {days} days
                </caption>
                <thead>
                  <tr>
                    <th scope="col">User</th>
                    <th scope="col">Last observed activity</th>
                    <th scope="col">Reports</th>
                    <th scope="col">BHC</th>
                    <th scope="col">Reminders</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.data.users.map((u) => (
                    <tr key={u.id}>
                      <td data-label="User">
                        <div>
                          <button
                            className="text-button"
                            aria-pressed={selected === u.id}
                            onClick={() => setSelected(u.id)}
                          >
                            {accountName(u)}
                          </button>
                          {u.email && u.display_name.trim() && (
                            <small>{u.email}</small>
                          )}
                          {u.role === "admin" && <small>Owner</small>}
                          {!u.approved && <small>Unapproved</small>}
                        </div>
                      </td>
                      <td data-label="Last observed activity">
                        <div>
                          {adminStamp(u.last_observed_at)}
                          <small>
                            First: {adminStamp(u.first_observed_at)}
                          </small>
                        </div>
                      </td>
                      <td data-label="Reports">
                        <div>
                          {u.report_count} total · {u.reports_created} new
                          <small>Last: {adminStamp(u.last_report_at)}</small>
                        </div>
                      </td>
                      <td data-label="BHC">
                        <div>
                          {u.bhc_connected
                            ? u.bhc_problem
                              ? "Needs attention"
                              : "Connected"
                            : "Not connected"}
                          {u.bhc_connected && (
                            <small>Synced: {adminStamp(u.last_sync)}</small>
                          )}
                        </div>
                      </td>
                      <td data-label="Reminders">
                        <div>
                          {u.reminders_paused
                            ? "Paused"
                            : u.reminder_channels.join(" + ") || "Off"}
                          {u.reminder_problem && <small>Needs attention</small>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!activity.data.users.length && <p>No accounts yet.</p>}
          </>
        )}
      </section>
      {user && (
        <AccountHistory
          key={user.id}
          user={user}
          onClose={() => setSelected("")}
        />
      )}
    </>
  );
}
