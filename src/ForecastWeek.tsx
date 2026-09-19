import {
  directionLabel,
  formatDate,
  formatTime,
  type Forecast,
  type WeatherHour,
} from "../shared/domain";
import { weatherDescription } from "../shared/presentation";
import { practiceWindows } from "../shared/timeline";
import type { WindowSummary } from "../shared/timeline";
import ForecastDayView from "./ForecastDayView";

const range = (
  value: { min: number; max: number } | null,
  digits = 0,
  unit = "",
) =>
  value === null
    ? "—"
    : value.min.toFixed(digits) === value.max.toFixed(digits)
      ? `${value.min.toFixed(digits)}${unit}`
      : `${value.min.toFixed(digits)}–${value.max.toFixed(digits)}${unit}`;

/** One practice window's summary. Coverage is stated, never implied by a blank. */
export function WindowReading({
  summary,
  expired,
}: {
  summary: WindowSummary;
  expired: boolean;
}) {
  const status = expired ? "unavailable" : summary.status;
  if (!summary.samples)
    return <p className="window-empty">Forecast not available.</p>;
  return (
    <>
      <p className={`wind-speed ${status}`}>
        <span aria-hidden="true">
          {range(summary.wind)} <small>mph</small>
        </span>
        <span className="sr-only">
          Wind {range(summary.wind)} miles per hour
          {summary.gust === null
            ? ""
            : `, gusting to ${summary.gust.toFixed(0)}`}
          .
        </span>
      </p>
      <span className="window-facts">
        G{summary.gust?.toFixed(0) ?? "—"} ·{" "}
        {summary.direction === null
          ? "—"
          : summary.direction.variable
            ? "Variable"
            : directionLabel(summary.direction.bearing)}{" "}
        · {range(summary.temperature, 0, "°F")}
      </span>
      <span className="window-facts">
        {summary.probability === null
          ? "Rain chance unknown"
          : `${range(summary.probability)}% rain`}{" "}
        ·{" "}
        {/* The highest WMO code, which runs roughly clear to thunderstorm, to
            match the worst-in-window rule the status already follows. */}
        {summary.codes.length
          ? weatherDescription(Math.max(...summary.codes))
          : "Conditions unknown"}
      </span>
      {!summary.covered && (
        <span className="window-partial">
          Partial coverage · {summary.samples} samples
        </span>
      )}
    </>
  );
}

export default function ForecastWeek({
  weather,
  days,
  day,
  today,
  daySamples,
  expired,
  now,
  onSelectDay,
}: {
  weather: Forecast;
  days: string[];
  day: string;
  today: string;
  daySamples: WeatherHour[];
  expired: boolean;
  now: number;
  onSelectDay: (day: string) => void;
}) {
  return (
    <>
      <div className="week-grid">
        {days.map((d) => (
          <article key={d} aria-current={d === day ? "true" : undefined}>
            <button className="text-button" onClick={() => onSelectDay(d)}>
              {formatDate(d + "T12:00:00Z")}
            </button>
            {practiceWindows(weather, d).map((w) => (
              <div className="practice-window" key={w.id}>
                <span className="eyebrow">
                  {w.label} ·{" "}
                  {Number.isFinite(w.startsAt)
                    ? `${formatTime(new Date(w.startsAt).toISOString())}–${formatTime(new Date(w.endsAt).toISOString())}`
                    : `${w.start}–${w.end}`}
                </span>
                <WindowReading summary={w.summary} expired={expired} />
              </div>
            ))}
          </article>
        ))}
      </div>
      <ForecastDayView
        weather={weather}
        days={days}
        day={day}
        today={today}
        daySamples={daySamples}
        expired={expired}
        now={now}
        onSelectDay={onSelectDay}
      />
    </>
  );
}
