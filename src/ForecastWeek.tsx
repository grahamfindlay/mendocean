import {
  formatDate,
  formatTime,
  type Forecast,
  type WeatherHour,
} from "../shared/domain";
import { practiceWindows } from "../shared/timeline";
import ForecastDayView from "./ForecastDayView";
import { WindowReading } from "./WindowReading";

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
      <div className="week-grid row-grid scheduled-row-grid">
        {days.map((d) => (
          <article key={d} aria-current={d === day ? "true" : undefined}>
            <button
              className="row-card scheduled-row-card week-card"
              aria-pressed={d === day}
              onClick={() => onSelectDay(d)}
            >
              <span className="row-meta">{formatDate(d + "T12:00:00Z")}</span>
              {practiceWindows(weather, d).map((w) => (
                <span className="practice-window" key={w.id}>
                  <span className="row-meta">
                    {w.label}{" "}
                    <span className="window-time row-meta">
                      {Number.isFinite(w.startsAt)
                        ? `${formatTime(new Date(w.startsAt).toISOString())} – ${formatTime(new Date(w.endsAt).toISOString())}`
                        : `${w.start}–${w.end}`}
                    </span>
                  </span>
                  <WindowReading summary={w.summary} expired={expired} />
                </span>
              ))}
            </button>
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
