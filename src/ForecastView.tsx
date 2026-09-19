import { useEffect, useState } from "react";
import {
  formatDate,
  formatTime,
  localDateTime,
  weatherFreshness,
  type Forecast,
  type Outing,
} from "../shared/domain";
import ForecastToday from "./ForecastToday";
import ForecastRows from "./ForecastRows";
import ForecastWeek from "./ForecastWeek";
import { timelineSamples, forecastDays } from "../shared/timeline";

export interface ForecastSelection {
  starts_at: string;
  ends_at: string;
  id: string;
}
export default function ForecastView({
  weather,
  tab,
  outings,
  onLog,
  onSchedule,
  now,
  selection,
  userId,
}: {
  weather: Forecast;
  tab: string;
  outings: Outing[];
  onLog: () => void;
  onSchedule: () => void;
  now: number;
  selection?: ForecastSelection;
  userId?: string;
}) {
  /* Held here rather than in the destination components so the selected row,
     day and horizon survive moving between Today, Week and Rows. */
  const [horizon, setHorizon] = useState("4");
  const [selectedDay, setSelectedDay] = useState("");
  const [selectedRow, setSelectedRow] = useState("");
  useEffect(() => {
    // Only the id is consulted: the row supplies its own times. The rest of
    // ForecastSelection is still carried for the resume payload's shape.
    if (selection) setSelectedRow(selection.id);
  }, [selection]);
  const fresh = weatherFreshness(weather.fetched_at, now);
  const expired = fresh === "expired";
  const days = forecastDays(weather, now);
  const day = days.includes(selectedDay) ? selectedDay : days[0];
  const daySamples = timelineSamples(weather).filter((h) =>
    localDateTime(h.time).startsWith(day),
  );
  const today = localDateTime(new Date(now).toISOString()).slice(0, 10);
  return (
    <>
      <div className="page-heading concise-heading">
        <div>
          <h1>{tab}</h1>
          {tab === "Rows" && (
            <p>Choose a date and time, or a row, to see its forecast.</p>
          )}
        </div>
      </div>
      {fresh !== "fresh" && (
        <div className="alert">
          {expired
            ? "This forecast has expired. Wind colors are unavailable until a fresh forecast arrives."
            : "This forecast is more than two hours old. Conditions may have changed."}
        </div>
      )}
      {tab === "Today" && (
        <ForecastToday
          weather={weather}
          expired={expired}
          now={now}
          onLog={onLog}
          horizon={horizon}
          onSelectHorizon={setHorizon}
        />
      )}
      {tab === "Week" && (
        <ForecastWeek
          weather={weather}
          days={days}
          day={day}
          today={today}
          daySamples={daySamples}
          expired={expired}
          now={now}
          onSelectDay={setSelectedDay}
        />
      )}
      {tab === "Rows" && (
        <ForecastRows
          weather={weather}
          outings={outings}
          now={now}
          expired={expired}
          selectedRow={selectedRow}
          onSelectRow={setSelectedRow}
          onSchedule={onSchedule}
          days={days}
          day={day}
          today={today}
          daySamples={daySamples}
          onSelectDay={setSelectedDay}
          userId={userId}
        />
      )}
      <aside className="method-note">
        <span>
          Weather: <a href="https://open-meteo.com/">{weather.provider}</a> ·
          Updated {formatDate(weather.fetched_at)},{" "}
          {formatTime(weather.fetched_at)}
        </span>
        <details>
          <summary>Wind colors: Hannah’s heuristic</summary>
          <p>Version: {weather.model_version}</p>
          <p className="wind-key">
            <span className="favorable">○ bussin’</span>
            <span className="caution">△ sus</span>
            <span className="unfavorable">◇ chopped</span>
          </p>
          <p>
            Thresholds depend on wind direction. Wind colors describe the
            heuristic, not measured water conditions.
          </p>
        </details>
      </aside>
    </>
  );
}
