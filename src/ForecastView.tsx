import { useEffect, useState } from "react";
import {
  formatDate,
  formatTime,
  localDateTime,
  weatherFreshness,
  type Forecast,
  type Outing,
} from "../shared/domain";
import ForecastDayView from "./ForecastDayView";
import ForecastToday from "./ForecastToday";
import ForecastRows from "./ForecastRows";
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
  now,
  selection,
  userId,
}: {
  weather: Forecast;
  tab: string;
  outings: Outing[];
  onLog: () => void;
  now: number;
  selection?: ForecastSelection;
  userId?: string;
}) {
  /* Held here rather than in the destination components so a selection, a
     chosen window and a chosen day survive moving between Today, Week and
     Rows. */
  const [when, setWhen] = useState(
    localDateTime(new Date(Date.now() + 86400000).toISOString()).slice(0, 11) +
      "07:00",
  );
  const [horizon, setHorizon] = useState("4");
  const [selectedDay, setSelectedDay] = useState("");
  const [duration, setDuration] = useState("90");
  useEffect(() => {
    if (selection) {
      setWhen(localDateTime(selection.starts_at));
      setDuration(
        String(
          Math.max(
            1,
            Math.round(
              (Date.parse(selection.ends_at) -
                Date.parse(selection.starts_at)) /
                60000,
            ),
          ),
        ),
      );
    }
  }, [selection]);
  const fresh = weatherFreshness(weather.fetched_at, now);
  const expired = fresh === "expired";
  const days = forecastDays(weather, now);
  const day = days.includes(selectedDay) ? selectedDay : days[0];
  const daySamples = timelineSamples(weather).filter((h) =>
    localDateTime(h.time).startsWith(day),
  );
  const today = localDateTime(new Date(now).toISOString()).slice(0, 10);
  /* Week shows this on its own; Rows shows it below the comparison grid. */
  const dayView = (
    <ForecastDayView
      weather={weather}
      days={days}
      day={day}
      today={today}
      daySamples={daySamples}
      expired={expired}
      now={now}
      onSelectDay={setSelectedDay}
    />
  );
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
      {tab === "Week" && dayView}
      {tab === "Rows" && (
        <ForecastRows
          weather={weather}
          outings={outings}
          now={now}
          expired={expired}
          when={when}
          onSelectWhen={setWhen}
          duration={duration}
          onSelectDuration={setDuration}
          onSelectDay={setSelectedDay}
          dayView={dayView}
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
