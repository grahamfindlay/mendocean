import {
  formatDate,
  formatTime,
  RATINGS,
  type Outing,
  type Report,
} from "../shared/domain";
import {
  Check,
  ChevronDown,
  CloudUpload,
  PenLine,
  SlidersHorizontal,
  RefreshCw,
  Share,
  Trash2,
} from "lucide-react";
import { visibleOutings, type RowFilters } from "../shared/presentation";
import {
  accountReminderBlock,
  reminderBlockMessage,
  reminderPresentation,
  type ReminderProfile,
} from "../shared/reminders";
export default function HistoryView({
  outings,
  queued,
  profile,
  now,
  user,
  filters,
  onFilters,
  onLog,
  onEdit,
  onDelete,
  onShare,
  onSettings,
  onRefresh,
  busy,
}: {
  outings: Outing[];
  /** Row ids whose report is saved on this device and not yet uploaded. */
  queued: string[];
  profile: ReminderProfile;
  now: number;
  user: string;
  filters: RowFilters;
  onFilters: (filters: RowFilters) => void;
  onLog: (outing: Outing) => void;
  onEdit: (outing: Outing, report: Report) => void;
  onDelete: (report: Report) => void;
  onShare: (outing: Outing) => void;
  onSettings: () => void;
  onRefresh: () => void;
  busy: boolean;
}) {
  const inView: RowFilters = {
    type: filters.type,
    attendance: "All",
    reports: filters.reports,
    allPractices: false,
  };
  const active = [inView.type !== "All", inView.reports !== "All"].filter(
    Boolean,
  ).length;
  const set = (patch: RowFilters) => onFilters({ ...filters, ...patch });
  const visible = visibleOutings(outings, "Past", now, inView);
  const accountBlock = accountReminderBlock(visible, profile, now);
  return (
    <>
      <div className="history-toolbar">
        <details className="row-filters">
          <summary>
            <SlidersHorizontal size={15} />
            Filters{active ? ` · ${active}` : ""}
            <ChevronDown className="chevron" size={16} />
          </summary>
          <div className="row-filter-fields">
            <label>
              Type
              <select
                value={inView.type}
                onChange={(e) =>
                  set({ type: e.target.value as RowFilters["type"] })
                }
              >
                {["All", "Practices", "Independent"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Reports
              <select
                value={inView.reports}
                onChange={(e) =>
                  set({ reports: e.target.value as RowFilters["reports"] })
                }
              >
                {["All", "Unlogged", "Logged"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            {!!active && (
              <button
                className="text-button"
                onClick={() =>
                  onFilters({
                    type: "All",
                    attendance: "All",
                    reports: "All",
                    allPractices: false,
                  })
                }
              >
                Clear filters
              </button>
            )}
          </div>
        </details>
        <button className="text-button" disabled={busy} onClick={onRefresh}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      {!visible.length && (
        <p className="empty">
          {active ? "No past rows match these filters." : "No past rows yet."}
        </p>
      )}
      {/* One notice for the whole list rather than the same sentence on every
          card: the owner clears it once, in Account. */}
      {accountBlock && (
        <p className="help reminder-notice">
          {reminderBlockMessage(accountBlock)}{" "}
          <button className="text-button" onClick={onSettings}>
            Reminder settings
          </button>
        </p>
      )}
      <div className="outing-grid history-grid">
        {visible.map((o) => {
          const report = o.reports?.[0];
          // Three states, never distinguished by color alone. A report held in
          // the outbox is neither logged nor waiting to be written, and saying
          // "No report yet" over work the owner already did is the worst of
          // the three mistakes.
          const status = report
            ? ("logged" as const)
            : queued.includes(o.id)
              ? ("pending" as const)
              : ("needed" as const);
          const reminder = reminderPresentation(o, profile, now);
          return (
            <article className="outing-card history-card" key={o.id}>
              <header className="row-card-header history-card-header">
                <div className="row-meta">
                  {formatDate(o.starts_at)} · {formatTime(o.starts_at)} –{" "}
                  {formatTime(o.ends_at)}
                </div>
                <div className="scheduled-card-top">
                  <h3 className="row-meta">{o.title}</h3>
                  <span className="row-kind">
                    {o.kind === "official" ? "Practice" : "Independent"}
                  </span>
                </div>
              </header>
              {status && (
                <div className={`report-summary log-status log-${status}`}>
                  <span className="log-mark">
                    {status === "logged" ? (
                      <Check size={14} />
                    ) : status === "pending" ? (
                      <CloudUpload size={14} />
                    ) : (
                      <PenLine size={14} />
                    )}
                    {status === "logged"
                      ? "Logged"
                      : status === "pending"
                        ? "Saved on this device"
                        : "Needs log"}
                  </span>
                  {report && (
                    <span>
                      {report.outcome === "rowed"
                        ? `${report.rating} · ${RATINGS[(report.rating || 1) - 1]} · ${report.route}`
                        : report.outcome === "stayed_ashore"
                          ? "Stayed ashore"
                          : "Didn’t attend"}
                    </span>
                  )}
                  {status === "pending" && <span>Waiting to upload.</span>}
                </div>
              )}
              <div className="card-actions outing-card-actions">
                {report ? (
                  <button
                    className="text-button"
                    onClick={() => onEdit(o, report)}
                  >
                    Edit report
                  </button>
                ) : (
                  // Withheld while a report for this row sits in the outbox:
                  // tapping it would stage a second one under a new submission
                  // id, and both would upload. The queue owns that report until
                  // it lands, including discarding it.
                  status !== "pending" && (
                    <button className="text-button" onClick={() => onLog(o)}>
                      Log this row
                    </button>
                  )
                )}
                <div className="history-icon-actions">
                  {o.kind === "independent" && o.owner_id === user && (
                    <button
                      className="icon-button"
                      aria-label="Share row"
                      title="Share row"
                      disabled={busy}
                      onClick={() => onShare(o)}
                    >
                      <Share size={17} />
                    </button>
                  )}
                  {report && (
                    <button
                      className="icon-button danger"
                      aria-label="Delete report"
                      title="Delete report"
                      disabled={busy}
                      onClick={() => onDelete(report)}
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </div>
              </div>
              {/* The state stays on the face of the card; only its controls
                  move, so a scheduled or failed reminder is still legible at a
                  glance. */}
              {reminder && (
                <p className="outing-reminder">
                  {reminder.text}
                  {reminder.due && (
                    <>
                      {" "}
                      · {formatDate(reminder.due)}, {formatTime(reminder.due)}
                    </>
                  )}
                  {reminder.sent && (
                    <>
                      {" "}
                      · {formatDate(reminder.sent)}, {formatTime(reminder.sent)}
                    </>
                  )}
                </p>
              )}
              {reminder && !!o.reminder_state?.channels?.length && (
                <details className="history-reminder-details">
                  <summary>Reminder delivery</summary>
                  <div className="reminder-details">
                    {o.reminder &&
                      !o.skipped &&
                      !!o.reminder_state?.channels?.length && (
                        <ul className="channel-status">
                          {o.reminder_state.channels.map((c) => (
                            <li key={c.channel}>
                              {c.channel === "email" ? "Email" : "Push"}:{" "}
                              {c.status === "sent"
                                ? "Sent"
                                : c.status === "not_requested"
                                  ? "Not requested for this reminder"
                                  : c.error === "no_device"
                                    ? "No registered device"
                                    : c.error === "quota"
                                      ? "Sending limit reached"
                                      : c.status === "retrying"
                                        ? "Retry scheduled"
                                        : c.status === "failed"
                                          ? "Could not send"
                                          : "Pending"}
                              {c.channel === "push" &&
                                c.devices_sent > 0 &&
                                c.status !== "sent" &&
                                ` · ${c.devices_sent} device${c.devices_sent === 1 ? "" : "s"} already accepted`}
                              {c.status === "retrying" &&
                                (c.error === "no_device" ||
                                  c.error === "quota") &&
                                " · Retry scheduled"}
                            </li>
                          ))}
                        </ul>
                      )}
                    <div className="card-actions">
                      {o.reminder_state?.channels?.some((c) => c.error) && (
                        <button className="text-button" onClick={onSettings}>
                          Reminder settings
                        </button>
                      )}
                    </div>
                  </div>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
