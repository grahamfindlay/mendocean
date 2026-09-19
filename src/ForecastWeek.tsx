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
      <div className="week-grid">
        {days.map((d) => (
          <article key={d} aria-current={d === day ? "true" : undefined}>
            <button className="text-button" onClick={() => onSelectDay(d)}>
              {formatDate(d + "T12:00:00Z")}
            </button>
            {practiceWindows(weather, d).map((w) => (
              <div className="practice-window" key={w.id}>
                <span className="eyebrow">
                  {w.label}{" "}
                  {/* Its own line, unbreakable: the monospaced, letter-spaced
                      eyebrow otherwise wraps between "5:30" and "AM". */}
                  <span className="window-time">
                    {Number.isFinite(w.startsAt)
                      ? `${formatTime(new Date(w.startsAt).toISOString())}–${formatTime(new Date(w.endsAt).toISOString())}`
                      : `${w.start}–${w.end}`}
                  </span>
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
