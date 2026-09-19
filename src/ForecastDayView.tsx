import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  highlight,
}: {
  weather: Forecast;
  days: string[];
  day: string;
  today: string;
  daySamples: WeatherHour[];
  expired: boolean;
  now: number;
  onSelectDay: (day: string) => void;
  highlight?: [number, number];
}) {
  const index = days.indexOf(day);
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selected.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [day]);
  return (
    <>
      {/* The arrows exist because the day row scrolls: on a phone the later
          days sit off-screen, and a partially visible next day alone does not
          say they are reachable. They sit outside .day-picker so that
          selector keeps meaning "a day". */}
      <div className="day-nav">
        <button
          className="day-step"
          aria-label="Earlier day"
          disabled={index <= 0}
          onClick={() => onSelectDay(days[index - 1])}
        >
          <ChevronLeft size={18} />
        </button>
        <div className="day-picker" role="group" aria-label="Forecast day">
          {days.map((d) => (
            <button
              key={d}
              ref={d === day ? selected : undefined}
              aria-pressed={day === d}
              onClick={() => onSelectDay(d)}
            >
              {formatDate(d + "T12:00:00Z")}
            </button>
          ))}
        </div>
        <button
          className="day-step"
          aria-label="Later day"
          disabled={index < 0 || index >= days.length - 1}
          onClick={() => onSelectDay(days[index + 1])}
        >
          <ChevronRight size={18} />
        </button>
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
        highlight={highlight}
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
