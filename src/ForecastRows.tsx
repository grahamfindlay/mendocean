import { useEffect } from "react";
import { CalendarPlus } from "lucide-react";
import {
  directionLabel,
  formatDate,
  formatTime,
  localDateTime,
  type Forecast,
  type Outing,
} from "../shared/domain";
import { dayBounds, summarizeWindow, windowSamples } from "../shared/timeline";
import {
  visibleOutings,
  scheduledAttendance,
  weatherDescription,
} from "../shared/presentation";
import WeatherChart from "./WeatherChart";
import WeatherIcon from "./WeatherIcon";

const choices = [
  ["attending", "Attending"],
  ["unknown", "Unknown"],
  ["declined", "Not attending"],
] as const;
const range = (value: { min: number; max: number } | null) =>
  !value
    ? "—"
    : Math.round(value.min) === Math.round(value.max)
      ? String(Math.round(value.min))
      : `${Math.round(value.min)}–${Math.round(value.max)}`;

export default function ForecastRows({
  weather,
  outings,
  now,
  expired,
  selectedRow,
  onSelectRow,
  onSchedule,
  userId,
  attendance,
  onAttendanceChange,
}: {
  weather: Forecast;
  outings: Outing[];
  now: number;
  expired: boolean;
  selectedRow: string;
  onSelectRow: (id: string) => void;
  onSchedule: () => void;
  userId?: string;
  attendance: string[];
  onAttendanceChange: (values: string[]) => void;
}) {
  const upcoming = visibleOutings(outings, "Upcoming", now);
  const matching = upcoming.filter((o) =>
    attendance.includes(scheduledAttendance(o)),
  );
  const row = matching.find((o) => o.id === selectedRow) || matching[0];
  useEffect(() => {
    if (row?.id !== selectedRow) onSelectRow(row?.id || "");
  }, [row?.id]);
  if (!userId)
    return (
      <section className="form-card">
        <h2>Sign in to forecast your rows</h2>
        <p>Scheduled rows and their forecasts need an account.</p>
        <p>Today and Week stay available without one.</p>
      </section>
    );
  const day = row ? localDateTime(row.starts_at).slice(0, 10) : "";
  const domain = day ? dayBounds(day) : undefined;
  const samples = domain ? windowSamples(weather, ...domain).samples : [];
  const start = row ? Date.parse(row.starts_at) : 0;
  const closest = samples.reduce<number | undefined>(
    (best, h) =>
      best === undefined ||
      Math.abs(Date.parse(h.time) - start) < Math.abs(best - start)
        ? Date.parse(h.time)
        : best,
    undefined,
  );
  return (
    <>
      <div className="scheduled-toolbar">
        <fieldset className="attendance-filters">
          <legend className="sr-only">
            Filter scheduled rows by attendance
          </legend>
          {choices.map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={attendance.includes(value)}
                onChange={(e) =>
                  onAttendanceChange(
                    e.target.checked
                      ? [...attendance, value]
                      : attendance.filter((v) => v !== value),
                  )
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <button
          className="button subtle"
          onClick={onSchedule}
          aria-label="Schedule independent row"
          title="Schedule independent row"
        >
          <CalendarPlus size={18} />
          <span className="scheduled-add-label">Schedule independent row</span>
        </button>
      </div>
      {!matching.length ? (
        <section className="form-card">
          <h2>
            {upcoming.length
              ? "No rows match these filters"
              : "No rows scheduled"}
          </h2>
          <p>
            {upcoming.length
              ? "Select an attendance status to see more scheduled rows."
              : "Schedule an independent row for any time and its forecast appears here."}
          </p>
        </section>
      ) : (
        <div className="row-grid scheduled-row-grid">
          {matching.map((o) => {
            const summary = summarizeWindow(
              weather,
              Date.parse(o.starts_at),
              Date.parse(o.ends_at),
            );
            const bearing = summary.direction?.variable
              ? null
              : summary.direction?.bearing;
            const code = summary.codes.length
              ? Math.max(...summary.codes)
              : null;
            return (
              <button
                className="row-card scheduled-row-card"
                key={o.id}
                aria-pressed={o.id === row?.id}
                onClick={() => onSelectRow(o.id)}
              >
                <span className="scheduled-card-top">
                  <span className="row-meta">{formatDate(o.starts_at)}</span>
                  <span className="attendance-badge">
                    {choices.find(([v]) => v === scheduledAttendance(o))![1]}
                  </span>
                </span>
                <span className="row-meta">
                  {formatTime(o.starts_at)} – {formatTime(o.ends_at)}
                </span>
                <h3 className="row-meta">{o.title}</h3>
                <span className="scheduled-card-weather">
                  {!summary.samples ? (
                    <span>Forecast not available.</span>
                  ) : (
                    <>
                      <span className="scheduled-weather-line">
                        <svg
                          viewBox="0 0 24 24"
                          width="20"
                          height="20"
                          role="img"
                          aria-label={
                            bearing == null
                              ? "Wind direction unavailable or variable"
                              : `Wind from ${directionLabel(bearing)}`
                          }
                        >
                          {bearing == null ? (
                            <text x="12" y="17" textAnchor="middle">
                              —
                            </text>
                          ) : (
                            <path
                              d="M12 3V21 M6 15L12 21L18 15"
                              transform={`rotate(${bearing} 12 12)`}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                          )}
                        </svg>
                        <span>
                          <span
                            className={`wind-speed ${expired ? "unavailable" : summary.status}`}
                          >
                            {range(summary.wind)} mph
                          </span>{" "}
                          • G{summary.gust?.toFixed(0) ?? "—"} •{" "}
                          {summary.direction?.variable
                            ? "Variable"
                            : `from ${directionLabel(bearing ?? null)}`}
                        </span>
                      </span>
                      <span className="scheduled-weather-line">
                        <WeatherIcon code={code} />
                        <span>
                          {range(summary.temperature)}°F •{" "}
                          {weatherDescription(code)} •{" "}
                          {summary.probability
                            ? `${range(summary.probability)}% rain`
                            : "Rain chance unknown"}
                        </span>
                      </span>
                      {!summary.covered && (
                        <span className="window-partial">
                          Partial forecast coverage
                        </span>
                      )}
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {row && (
        <WeatherChart
          key={row.id + row.starts_at}
          samples={samples}
          probabilityHours={weather.hours}
          domain={domain}
          initialTime={closest}
          expired={expired}
          title={formatDate(row.starts_at)}
          highlight={[start, Date.parse(row.ends_at)]}
        />
      )}
    </>
  );
}
