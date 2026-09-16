import {
  formatDate,
  formatTime,
  RATINGS,
  weatherFreshness,
  type Forecast,
  type Outing,
  type Report,
} from "../shared/domain";
import { canLog, outingPhase, sortedOutings } from "../shared/presentation";
import {
  reminderPresentation,
  type ReminderProfile,
} from "../shared/reminders";
import { windowSamples, sampleMinutes } from "../shared/timeline";
import { WindSpeed, Gust } from "./WindReading";
export type ReportFilter = "All" | "Unlogged" | "Logged";
export default function OutingsView({
  outings,
  profile,
  now,
  user,
  weather,
  view,
  filter,
  onView,
  onFilter,
  onLog,
  onEdit,
  onForecast,
  onDelete,
  onShare,
  onReminder,
  onSettings,
  busy,
}: {
  outings: Outing[];
  profile: ReminderProfile;
  now: number;
  user: string;
  weather: Forecast | null;
  view: "Upcoming" | "Past";
  filter: ReportFilter;
  onView: (view: "Upcoming" | "Past") => void;
  onFilter: (filter: ReportFilter) => void;
  onLog: (outing: Outing) => void;
  onEdit: (outing: Outing, report: Report) => void;
  onForecast: (outing: Outing) => void;
  onDelete: (report: Report) => void;
  onShare: (outing: Outing) => void;
  onReminder: (outing: Outing, action: "skip" | "enable" | "snooze") => void;
  onSettings: () => void;
  busy: boolean;
}) {
  const visible = sortedOutings(outings, view, now).filter(
    (o) =>
      view !== "Past" ||
      filter === "All" ||
      (filter === "Logged") === !!o.reports?.length,
  );
  return (
    <>
      <div className="outing-filters">
        <div className="segmented" aria-label="Outing time">
          {(["Upcoming", "Past"] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => onView(v)}>
              {v}
            </button>
          ))}
        </div>
        {view === "Past" && (
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
        )}
      </div>
      {!visible.length && (
        <p className="empty">
          {view === "Upcoming"
            ? "No upcoming outings. Add an independent outing or connect Boathouse Connect in Account."
            : filter === "All"
              ? "No past outings yet."
              : `No ${filter.toLowerCase()} past outings.`}
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
                      Log this outing
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
                  {phase !== "past" &&
                    !reminder.settings &&
                    reminder.toggle && (
                      <small>
                        To log after the outing, normally 15 minutes after it
                        ends.
                      </small>
                    )}
                  <div className="card-actions">
                    {reminder.settings && (
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
                        {reminder.sent
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
