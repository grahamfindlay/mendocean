import { useState } from "react";
import { ChevronDown } from "lucide-react";
import WeekPeriodsEditor from "./WeekPeriodsEditor";
import { useWeekPeriods } from "./useWeekPeriods";
import { periodsForDay } from "../shared/weekPeriods";
import {
  formatDate,
  formatTime,
  type Forecast,
  type WeatherHour,
} from "../shared/domain";
import { practiceWindows } from "../shared/timeline";
import ForecastDayView from "./ForecastDayView";
import { WindowReading } from "./WindowReading";
import "./ForecastWeek.css";

type PracticeWindow = ReturnType<typeof practiceWindows>[number];
function PeriodLabel({ window: w }: { window: PracticeWindow }) {
  const start = Number.isFinite(w.startsAt)
    ? formatTime(new Date(w.startsAt).toISOString())
    : w.start;
  const end = Number.isFinite(w.endsAt)
    ? formatTime(new Date(w.endsAt).toISOString())
    : w.end;
  let shortStart = start.replace(":00", "");
  const shortEnd = end.replace(":00", "");
  if (start.slice(-2) === end.slice(-2) && /[AP]M$/.test(start)) {
    shortStart = shortStart.replace(/ [AP]M$/, "");
  }
  return (
    <span className="week-period-label">
      {w.label}{" "}
      <span className="window-time">
        <span className="sr-only">
          {start} – {end}
        </span>
        <span aria-hidden="true">
          {shortStart}–{shortEnd}
        </span>
      </span>
    </span>
  );
}

export default function ForecastWeek({
  weather,
  userId,
  days,
  today,
  daySamples,
  expired,
  now,
  onSelectDay,
}: {
  weather: Forecast;
  userId?: string;
  days: string[];
  day: string;
  today: string;
  daySamples: WeatherHour[];
  expired: boolean;
  now: number;
  onSelectDay: (day: string) => void;
}) {
  const preferences = useWeekPeriods(userId);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const summaries = days.map((date) => ({
    date,
    windows: practiceWindows(
      weather,
      date,
      periodsForDay(preferences.periods, date),
    ),
  }));
  const firstWindows = summaries[0]?.windows ?? [];
  // Only share headings when every day has the same one or two periods.
  const sharedHeadings =
    firstWindows.length > 0 &&
    firstWindows.length <= 2 &&
    summaries.every(
      ({ windows }) =>
        windows.length === firstWindows.length &&
        windows.every((w, i) => w.id === firstWindows[i].id),
    );
  return (
    <>
      <WeekPeriodsEditor preferences={preferences} />
      <div
        className={`week-overview${sharedHeadings ? " week-shared-headings" : ""}`}
      >
        {sharedHeadings && (
          <div className="week-period-headings" aria-hidden="true">
            <span />
            <div className="week-period-grid">
              {firstWindows.map((w) => (
                <PeriodLabel key={w.id} window={w} />
              ))}
            </div>
          </div>
        )}
        <div className="week-grid row-grid scheduled-row-grid">
          {summaries.map(({ date: d, windows }) => {
            const dateLabel = formatDate(d + "T12:00:00Z");
            return (
              <article
                key={d}
                className={expandedDay === d ? "week-day-expanded" : undefined}
              >
                <button
                  className="row-card scheduled-row-card week-card"
                  aria-pressed={expandedDay === d}
                  aria-expanded={expandedDay === d}
                  aria-controls={`week-chart-${d}`}
                  onClick={() => {
                    setExpandedDay(expandedDay === d ? null : d);
                    onSelectDay(d);
                  }}
                >
                  <span className="week-date">
                    <ChevronDown
                      className="week-expand-icon"
                      size={14}
                      aria-hidden="true"
                    />
                    <span className="sr-only">{dateLabel}</span>
                    <span aria-hidden="true">
                      {d === today ? "Today" : dateLabel.split(",")[0]}
                      <small>{dateLabel.split(", ")[1]}</small>
                    </span>
                  </span>
                  <span className="week-period-grid">
                    {windows.length === 0 && (
                      <span className="week-no-periods">
                        No periods selected
                      </span>
                    )}
                    {windows.map((w) => (
                      <span className="practice-window" key={w.id}>
                        <PeriodLabel window={w} />
                        <WindowReading
                          summary={w.summary}
                          expired={expired}
                          compact
                        />
                      </span>
                    ))}
                  </span>
                </button>
                <div id={`week-chart-${d}`} hidden={expandedDay !== d}>
                  {expandedDay === d && (
                    <ForecastDayView
                      embedded
                      weather={weather}
                      days={days}
                      day={d}
                      today={today}
                      daySamples={daySamples}
                      expired={expired}
                      now={now}
                      onSelectDay={onSelectDay}
                      windows={windows.map((w) => ({
                        id: w.id,
                        label: w.label,
                        start: w.startsAt,
                        end: w.endsAt,
                      }))}
                    />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}
