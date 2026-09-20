import {
  formatDate,
  formatTime,
  type Forecast,
  type Outing,
} from "../shared/domain";
import { summarizeWindow } from "../shared/timeline";
import { scheduledAttendance } from "../shared/presentation";
import { WindowReading } from "./WindowReading";

const choices = [
  ["attending", "Attending"],
  ["unknown", "Unknown"],
  ["declined", "Not attending"],
] as const;

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
            <WindowReading summary={summary} expired={expired} />
          </button>
        );
      })}
    </div>
  );
}
