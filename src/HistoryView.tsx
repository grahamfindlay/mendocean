import { useState } from "react";
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
} from "lucide-react";
import { visibleOutings, type RowFilters } from "../shared/presentation";
import {
  accountReminderBlock,
  reminderBlockMessage,
  reminderPresentation,
  type ReminderProfile,
} from "../shared/reminders";
import { RowCardHeader } from "./RowCardHeader";
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
  onAttendance,
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
  onAttendance: (outing: Outing) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const inView: RowFilters = {
    type: filters.type,
    attendance: "All",
    reports: filters.reports,
    allPractices: filters.allPractices,
  };
  const active = [
    inView.type !== "All",
    inView.reports !== "All",
    inView.allPractices,
  ].filter(Boolean).length;
  const set = (patch: RowFilters) => onFilters({ ...filters, ...patch });
  const visible = visibleOutings(outings, "Past", now, inView);
  const accountBlock = accountReminderBlock(visible, profile, now);
  // A second pass rather than a flag on the first: the count is only wanted
  // when the list looks emptier than the owner expects.
  const hidden = !inView.allPractices
    ? visibleOutings(outings, "Past", now, { ...inView, allPractices: true })
        .length - visible.length
    : 0;
  return (
    <>
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
          <label className="filter-toggle">
            <input
              type="checkbox"
              checked={!!inView.allPractices}
              onChange={(e) => set({ allPractices: e.target.checked })}
            />
            Show all practices
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
      {!!hidden && (
        <p className="help">
          {hidden === 1
            ? "1 past practice you did not attend is hidden."
            : `${hidden} past practices you did not attend are hidden.`}
        </p>
      )}
      <div className="outing-grid">
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
          const more =
            (o.kind === "independent" && o.owner_id === user) ||
            !!report ||
            !!reminder;
          const open = expanded.includes(o.id);
          return (
            <article className="outing-card" key={o.id}>
              <RowCardHeader
                outing={o}
                showKind
                attendance={
                  o.kind === "official" ? (
                    <button
                      type="button"
                      aria-label={`Practice attendance: ${o.attendance === "attending" ? "Attending" : o.attendance === "declined" ? "Not attending" : "Unknown"}`}
                      aria-haspopup="dialog"
                      onClick={() => onAttendance(o)}
                      className={`attendance-badge attendance-${o.attendance || "unknown"}`}
                    >
                      {o.attendance === "attending"
                        ? "Attending"
                        : o.attendance === "declined"
                          ? "Not attending"
                          : "Unknown"}
                    </button>
                  ) : undefined
                }
              />
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
                {more && (
                  <button
                    className="text-button subtle-action"
                    aria-expanded={open}
                    aria-controls={`more-${o.id}`}
                    onClick={() =>
                      setExpanded((ids) =>
                        open ? ids.filter((id) => id !== o.id) : [...ids, o.id],
                      )
                    }
                  >
                    More
                    <ChevronDown
                      className="card-expand-icon"
                      size={18}
                      aria-hidden="true"
                    />
                  </button>
                )}
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
              {more && open && (
                <div className="card-more" id={`more-${o.id}`}>
                  {o.kind === "independent" && o.owner_id === user && (
                    <div className="card-actions">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => onShare(o)}
                      >
                        Share
                      </button>
                    </div>
                  )}
                  {report && (
                    <div className="card-actions">
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() => onDelete(report)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                  {reminder && (
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
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
