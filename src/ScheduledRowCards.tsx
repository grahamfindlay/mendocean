import { type ReactNode, useId } from "react";
import { type Forecast, type Outing } from "../shared/domain";
import { summarizeWindow } from "../shared/timeline";
import { scheduledAttendance } from "../shared/presentation";
import { RowCardHeader } from "./RowCardHeader";
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
  onAttendance,
  expired,
  expandedContent,
  renderRowActions,
}: {
  weather: Forecast;
  rows: Outing[];
  selectedRow?: string;
  onSelectRow: (id: string) => void;
  onAttendance: (outing: Outing) => void;
  expired: boolean;
  expandedContent?: ReactNode;
  renderRowActions?: (outing: Outing) => ReactNode;
}) {
  const id = useId();
  const expandable = expandedContent !== undefined;
  return (
    <div className="row-grid scheduled-row-grid">
      {rows.map((o) => {
        const summary = summarizeWindow(
          weather,
          Date.parse(o.starts_at),
          Date.parse(o.ends_at),
        );
        const attendanceLabel = choices.find(
          ([v]) => v === scheduledAttendance(o),
        )![1];
        const actions = renderRowActions?.(o);
        return (
          <article
            key={o.id}
            className={
              expandable && o.id === selectedRow
                ? "scheduled-row-entry scheduled-row-expanded"
                : "scheduled-row-entry"
            }
          >
            <button
              className="row-card scheduled-row-card"
              aria-pressed={o.id === selectedRow}
              aria-expanded={expandable ? o.id === selectedRow : undefined}
              aria-controls={expandable ? `${id}-${o.id}` : undefined}
              onClick={() => onSelectRow(o.id)}
            >
              <RowCardHeader
                outing={o}
                attendance={
                  <span
                    className={`attendance-badge${o.kind === "official" ? " attendance-placeholder" : ""}`}
                  >
                    {attendanceLabel}
                  </span>
                }
              />
              <WindowReading summary={summary} expired={expired} />
            </button>
            {o.kind === "official" && (
              <button
                type="button"
                className="attendance-badge scheduled-attendance-button"
                aria-label={`Practice attendance: ${attendanceLabel}`}
                aria-haspopup="dialog"
                onClick={() => onAttendance(o)}
              >
                {attendanceLabel}
              </button>
            )}
            {actions && <div className="scheduled-row-actions">{actions}</div>}
            {expandable && (
              <div id={`${id}-${o.id}`} hidden={o.id !== selectedRow}>
                {o.id === selectedRow && expandedContent}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
