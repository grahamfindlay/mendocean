import { formatDate, type Forecast, type WeatherHour } from "../shared/domain";
import { dayBounds, summarySamples, windowSamples } from "../shared/timeline";
import WeatherChart from "./WeatherChart";
import { HourRow } from "./HourRow";
/** The day picker, its chart and its expanded list. Week and Rows both show it. */
export default function ForecastDayView({
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
      <div className="day-picker" role="group" aria-label="Forecast day">
        {days.map((d) => (
          <button
            key={d}
            aria-pressed={day === d}
            onClick={() => onSelectDay(d)}
          >
            {formatDate(d + "T12:00:00Z")}
          </button>
        ))}
      </div>
      <WeatherChart
        key={day}
        samples={
          day ? windowSamples(weather, ...dayBounds(day)).samples : daySamples
        }
        domain={day ? dayBounds(day) : undefined}
        initialTime={day === today ? now : undefined}
        expired={expired}
        title={day ? formatDate(day + "T12:00:00Z") : "Daily forecast"}
      />
      <details className="sample-details">
        <summary>Detailed forecast for this day</summary>
        <div className="hour-table">
          {summarySamples(daySamples).map((h) => (
            <HourRow
              key={h.time}
              hour={h}
              hours={weather.hours}
              expired={expired}
            />
          ))}
        </div>
      </details>
    </>
  );
}
