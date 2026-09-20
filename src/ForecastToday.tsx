import { ArrowRight } from "lucide-react";
import {
  directionLabel,
  formatDate,
  formatTime,
  localDateTime,
  type Forecast,
} from "../shared/domain";
import { forecastSamples, weatherDescription } from "../shared/presentation";
import { nearTerm, windowSamples, dayBounds } from "../shared/timeline";
import WeatherChart from "./WeatherChart";
import { HourRow, RainChance } from "./HourRow";
import { WindCompass, WindSpeed } from "./WindReading";

export default function ForecastToday({
  weather,
  expired,
  now,
  onLog,
  horizon,
  onSelectHorizon,
}: {
  weather: Forecast;
  expired: boolean;
  now: number;
  onLog: () => void;
  horizon: string;
  onSelectHorizon: (horizon: string) => void;
}) {
  const { upcoming, current } = forecastSamples(weather, now);
  const near = nearTerm(weather, now);
  const todayDomain = dayBounds(
    localDateTime(new Date(now).toISOString()).slice(0, 10),
  );
  const todaySamples = windowSamples(weather, ...todayDomain).samples;
  const rollingDomain: [number, number] = [
    now,
    now + Number(horizon) * 3600000,
  ];
  const rolling = windowSamples(weather, ...rollingDomain);
  return (
    <>
      {current ? (
        <section className="current-panel">
          <div className="current-weather">
            <div className="current-wind">
              <WindCompass direction={current.direction} />
              <div>
                <WindSpeed hour={current} expired={expired} />
                <p>From {directionLabel(current.direction)}</p>
              </div>
            </div>
            <div className="weather-facts">
              <span>
                Gusts <b>{current.gust?.toFixed(0) ?? "—"} mph</b>
              </span>
              <span>
                Air <b>{current.temperature?.toFixed(0) ?? "—"}°F</b>
              </span>
              <RainChance hours={weather.hours} time={current.time} />
            </div>
            <details className="sample-time">
              <summary>Weather details</summary>
              <p>
                Sample:{" "}
                <time dateTime={current.time}>
                  {formatDate(current.time)} · {formatTime(current.time)}
                </time>
              </p>
            </details>
            <p className="current-description">
              {weatherDescription(current.code)}
            </p>
          </div>
        </section>
      ) : (
        <p className="empty">
          A current estimate is unavailable. Upcoming forecasts are shown below.
        </p>
      )}
      <div className="section-heading">
        <h2>The next few hours</h2>
      </div>
      <section className="hour-table">
        {near.map((h) => (
          <HourRow
            key={h.time}
            hour={h}
            hours={weather.hours}
            expired={expired}
          />
        ))}
        {!upcoming.length && (
          <p className="empty">No upcoming forecast is available.</p>
        )}
      </section>
      <WeatherChart
        probabilityHours={weather.hours}
        samples={todaySamples}
        domain={todayDomain}
        initialTime={now}
        expired={expired}
        title="All day"
      />
      <label className="horizon-picker">
        Hours ahead
        <select
          value={horizon}
          onChange={(e) => onSelectHorizon(e.target.value)}
        >
          {Array.from({ length: 23 }, (_, i) => i + 2).map((n) => (
            <option key={n} value={n}>
              {n} hours
            </option>
          ))}
        </select>
      </label>
      <WeatherChart
        probabilityHours={weather.hours}
        key={horizon}
        samples={rolling.samples}
        domain={rollingDomain}
        initialTime={now}
        expired={expired}
        title={`Next ${horizon} hours`}
      />
      {!rolling.covered && (
        <p className="help">
          Some forecast samples are unavailable in this window.
        </p>
      )}
      <div className="log-callout">
        <h2>How was the water?</h2>
        <button className="button" onClick={onLog}>
          Log a row <ArrowRight size={17} />
        </button>
      </div>
    </>
  );
}
