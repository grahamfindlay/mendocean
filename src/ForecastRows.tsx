import { useEffect, useState } from "react";
import { CalendarPlus } from "lucide-react";
import {
  formatDate,
  localDateTime,
  type Forecast,
  type Outing,
} from "../shared/domain";
import { dayBounds, windowSamples } from "../shared/timeline";
import { visibleOutings, scheduledAttendance } from "../shared/presentation";
import WeatherChart from "./WeatherChart";
import { AttendanceFilters, ScheduledRowCards } from "./ScheduledRowCards";

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
  onAttendance,
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
  onAttendance: (outing: Outing) => void;
}) {
  const upcoming = visibleOutings(outings, "Upcoming", now);
  const matching = upcoming.filter((o) =>
    attendance.includes(scheduledAttendance(o)),
  );
  const [expandedRow, setExpandedRow] = useState<string | null>(
    selectedRow || null,
  );
  // An explicit "View forecast" action can open a row; ordinary visits start collapsed.
  useEffect(() => {
    if (selectedRow) {
      setExpandedRow(selectedRow);
      onSelectRow("");
    }
  }, [selectedRow, onSelectRow]);
  const row = matching.find((o) => o.id === expandedRow);
  useEffect(() => {
    if (!row) setExpandedRow(null);
  }, [row]);
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
        <AttendanceFilters
          attendance={attendance}
          onAttendanceChange={onAttendanceChange}
        />
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
        <ScheduledRowCards
          weather={weather}
          onAttendance={onAttendance}
          rows={matching}
          selectedRow={row?.id}
          onSelectRow={(id) => {
            setExpandedRow(expandedRow === id ? null : id);
          }}
          expired={expired}
          expandedContent={
            row ? (
              <WeatherChart
                key={row.id + row.starts_at}
                showTitle={false}
                samples={samples}
                probabilityHours={weather.hours}
                domain={domain}
                initialTime={closest}
                expired={expired}
                title={formatDate(row.starts_at)}
                highlight={[start, Date.parse(row.ends_at)]}
              />
            ) : null
          }
        />
      )}
    </>
  );
}
