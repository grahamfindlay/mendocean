import {
  formatDate,
  formatTime,
  RATINGS,
  weatherFreshness,
  type Forecast,
  type Outing,
  type Report,
} from "../shared/domain";
import {
  canLog,
  outingPhase,
  visibleOutings,
  type ReportFilter,
} from "../shared/presentation";
import {
  reminderPresentation,
  type ReminderProfile,
} from "../shared/reminders";
import { windowSamples, sampleMinutes } from "../shared/timeline";
import { WindSpeed, Gust } from "./WindReading";
export default function OutingsView({
  outings,
  profile,
  now,
  user,
  weather,
  view,
  filter,
  allPractices,
  onView,
  onFilter,
  onAllPractices,
  onLog,
  onEdit,
  onForecast,
  onDelete,
  onShare,
  onReminder,
  onSettings,
  onAttendance,
  bhcConnected,
  busy,
}: {
  outings: Outing[];
  profile: ReminderProfile;
  now: number;
  user: string;
  weather: Forecast | null;
  view: "Upcoming" | "Past";
  filter: ReportFilter;
  allPractices: boolean;
  onView: (view: "Upcoming" | "Past") => void;
  onFilter: (filter: ReportFilter) => void;
  onAllPractices: (allPractices: boolean) => void;
  onLog: (outing: Outing) => void;
  onEdit: (outing: Outing, report: Report) => void;
  onForecast: (outing: Outing) => void;
  onDelete: (report: Report) => void;
  onShare: (outing: Outing) => void;
  onReminder: (outing: Outing, action: "skip" | "enable" | "snooze") => void;
  onSettings: () => void;
  onAttendance: (outing: Outing) => void;
  bhcConnected: boolean;
  busy: boolean;
}) {
  // The report filter is a Past affordance, so Upcoming is asked for "All"
  // rather than inheriting whatever Past was left on.
  const filters = {
    reports: view === "Past" ? filter : ("All" as ReportFilter),
    allPractices,
  };
  const visible = visibleOutings(outings, view, now, filters);
  // A second pass rather than a flag on the first: the count is only wanted
  // when the list looks emptier than the owner expects.
  const hidden =
    view === "Past" && !allPractices
      ? visibleOutings(outings, view, now, { ...filters, allPractices: true })
          .length - visible.length
      : 0;
  return (
    <>
      <div className="outing-filters">
        <div className="segmented" aria-label="Row time">
          {(["Upcoming", "Past"] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => onView(v)}>
              {v}
            </button>
          ))}
        </div>
        {view === "Past" && (
          <>
            <div className="segmented small" aria-label="Report filter">
              {(["All", "Unlogged", "Logged"] as const).map((v) => (
                <button
                  key={v}
                  aria-pressed={filter === v}
                  onClick={() => onFilter(v)}
                >
                  {v}
                </button>
              ))}
            </div>
            <label className="filter-toggle">
              <input
                type="checkbox"
                checked={allPractices}
                onChange={(e) => onAllPractices(e.target.checked)}
              />
              Show all practices
            </label>
          </>
        )}
      </div>
      {!visible.length && (
        <p className="empty">
          {view === "Upcoming"
            ? "No upcoming rows. Add an independent row or connect Boathouse Connect in Account."
            : filter === "All"
              ? "No past rows yet."
              : `No ${filter.toLowerCase()} past rows.`}
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
          const phase = outingPhase(o, now);
          const reminder = reminderPresentation(o, profile, now);
          const preview = weather
            ? windowSamples(
                weather,
                Date.parse(o.starts_at),
                Date.parse(o.starts_at),
              )
            : null;
          const hour = preview?.covered ? preview.samples[0] : undefined;
          return (
            <article className="outing-card" key={o.id}>
              <div className="card-top">
                <span className="eyebrow">
                  {o.kind === "official" ? "PRACTICE" : "INDEPENDENT"}
                </span>
                {o.kind === "official" && (
                  <span
                    className={`attendance-badge attendance-${o.attendance || "unknown"}`}
                  >
                    {o.attendance === "attending"
                      ? "Attending"
                      : o.attendance === "declined"
                        ? "Not attending"
                        : "Unknown"}
                  </span>
                )}
              </div>
              <h3>{o.title}</h3>
              <p>
                {formatDate(o.starts_at)} · {formatTime(o.starts_at)}–
                {formatTime(o.ends_at)}
              </p>
              {phase === "in_progress" && (
                <p className="phase-label">In progress</p>
              )}
              {report ? (
                <div className="report-summary">
                  {report.outcome === "rowed"
                    ? `${report.rating} · ${RATINGS[(report.rating || 1) - 1]} · ${report.route}`
                    : report.outcome === "stayed_ashore"
                      ? "Stayed ashore"
                      : "Didn’t attend"}
                </div>
              ) : (
                phase === "past" && (
                  <div className="report-summary muted">No report yet</div>
                )
              )}
              {phase !== "past" && (
                <div className="outing-forecast">
                  {hour &&
                  weather &&
                  weatherFreshness(weather.fetched_at, now) !== "expired" ? (
                    <>
                      <small>
                        {sampleMinutes(hour)}-minute forecast ·{" "}
                        {formatTime(hour.time)}
                      </small>
                      <span>
                        <WindSpeed hour={hour} /> <Gust value={hour.gust} /> ·{" "}
                        {hour.temperature?.toFixed(0) ?? "—"}°F
                      </span>
                    </>
                  ) : (
                    <small>Forecast not available yet.</small>
                  )}
                </div>
              )}
              <div className="card-actions">
                {o.kind === "official" &&
                  phase === "future" &&
                  bhcConnected && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => onAttendance(o)}
                    >
                      {o.attendance_deadline &&
                      now >= Date.parse(o.attendance_deadline)
                        ? "Attendance details"
                        : "Change attendance"}
                    </button>
                  )}
                {phase !== "past" && (
                  <button className="text-button" onClick={() => onForecast(o)}>
                    View forecast
                  </button>
                )}
                {report ? (
                  <>
                    <button
                      className="text-button"
                      onClick={() => onEdit(o, report)}
                    >
                      Edit report
                    </button>
                    <button
                      className="text-button danger"
                      disabled={busy}
                      onClick={() => onDelete(report)}
                    >
                      Delete
                    </button>
                  </>
                ) : (
                  canLog(o, now) && (
                    <button className="text-button" onClick={() => onLog(o)}>
                      Log this row
                    </button>
                  )
                )}
                {o.kind === "independent" && o.owner_id === user && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => onShare(o)}
                  >
                    Share
                  </button>
                )}
              </div>
              {reminder && (
                <div className="outing-reminder">
                  <p>
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
                        · {formatDate(reminder.sent)},{" "}
                        {formatTime(reminder.sent)}
                      </>
                    )}
                  </p>
                  {o.reminder &&
                    !o.skipped &&
                    !reminder.settings &&
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
                  {phase !== "past" &&
                    !reminder.settings &&
                    reminder.toggle && (
                      <small>
                        To log after the outing, normally 15 minutes after it
                        ends.
                      </small>
                    )}
                  {reminder.partial && reminder.snooze && (
                    <small>
                      Requesting another reminder sends all your selected
                      channels again.
                    </small>
                  )}
                  <div className="card-actions">
                    {(reminder.settings ||
                      o.reminder_state?.channels?.some((c) => c.error)) && (
                      <button className="text-button" onClick={onSettings}>
                        Reminder settings
                      </button>
                    )}
                    {reminder.toggle &&
                      (phase !== "past" ||
                        (reminder.toggle === "skip" && !reminder.sent)) && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => onReminder(o, reminder.toggle!)}
                        >
                          {reminder.toggle === "skip"
                            ? "Turn off logging reminder"
                            : "Turn on logging reminder"}
                        </button>
                      )}
                    {reminder.snooze && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => onReminder(o, "snooze")}
                      >
                        {reminder.sent || reminder.partial
                          ? "Remind me again in 1 hour"
                          : "Remind me to log in 1 hour"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
