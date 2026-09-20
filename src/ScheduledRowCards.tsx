import {
  directionLabel,
  formatDate,
  formatTime,
  type Forecast,
  type Outing,
} from "../shared/domain";
import { summarizeWindow } from "../shared/timeline";
import {
  scheduledAttendance,
  weatherDescription,
} from "../shared/presentation";
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

export function AttendanceFilters({
  attendance,
  onAttendanceChange,
}: {
  attendance: string[];
  onAttendanceChange: (values: string[]) => void;
}) {
  return (
    <fieldset className="attendance-filters">
      <legend className="sr-only">Filter scheduled rows by attendance</legend>
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
  );
}

export function ScheduledRowCards({
  weather,
  rows,
  selectedRow,
  onSelectRow,
  expired,
}: {
  weather: Forecast;
  rows: Outing[];
  selectedRow?: string;
  onSelectRow: (id: string) => void;
  expired: boolean;
}) {
  return (
    <div className="row-grid scheduled-row-grid">
      {rows.map((o) => {
        const summary = summarizeWindow(
          weather,
          Date.parse(o.starts_at),
          Date.parse(o.ends_at),
        );
        const bearing = summary.direction?.variable
          ? null
          : summary.direction?.bearing;
        const code = summary.codes.length ? Math.max(...summary.codes) : null;
        return (
          <button
            className="row-card scheduled-row-card"
            key={o.id}
            aria-pressed={o.id === selectedRow}
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
  );
}
