import { directionLabel, formatTime, type WeatherHour } from "../shared/domain";
import { weatherDescription } from "../shared/presentation";
import { hourlyRainChance } from "../shared/timeline";
import { Gust, WindSpeed, WindVector } from "./WindReading";
export function RainChance({
  hours,
  time,
}: {
  hours: WeatherHour[];
  time: string;
}) {
  const chance = hourlyRainChance(hours, time);
  return chance ? (
    <span className="rain-chance">
      Hourly rain chance <b>{chance.probability}%</b>{" "}
      <small>
        {formatTime(new Date(chance.start).toISOString())}–
        {formatTime(new Date(chance.end).toISOString())}
      </small>
    </span>
  ) : (
    <span>Rain chance unavailable</span>
  );
}

export function HourRow({
  hour,
  expired = false,
  hours = [],
}: {
  hours?: WeatherHour[];
  hour: WeatherHour;
  expired?: boolean;
}) {
  return (
    <details className="hour-detail">
      <summary className="hour-row">
        <time dateTime={hour.time}>{formatTime(hour.time)}</time>
        <span className="wind-cell">
          <WindSpeed hour={hour} expired={expired} />
          <span className="wind-direction">
            <WindVector hour={hour} expired={expired} /> From{" "}
            {directionLabel(hour.direction)}
          </span>
        </span>
        <Gust value={hour.gust} />
        <span>{hour.temperature?.toFixed(0) ?? "—"}°F</span>
        <span className="weather-description">
          {weatherDescription(hour.code)}
        </span>
      </summary>
      <div className="hour-more">
        <span>
          Conditions <b>{weatherDescription(hour.code)}</b>
        </span>
        <RainChance hours={hours} time={hour.time} />
        <span>
          Visibility{" "}
          <b>
            {hour.visibility == null
              ? "—"
              : (hour.visibility / 1609.344).toFixed(1)}{" "}
            mi
          </b>
        </span>
      </div>
    </details>
  );
}
