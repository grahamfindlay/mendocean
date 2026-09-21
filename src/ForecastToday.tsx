import { useEffect, useState } from "react";
import {
  directionLabel,
  localDateTime,
  type Forecast,
  type Outing,
} from "../shared/domain";
import {
  forecastSamples,
  scheduledAttendance,
  weatherDescription,
} from "../shared/presentation";
import { hourlyRainChance, windowSamples, dayBounds } from "../shared/timeline";
import { Camera } from "lucide-react";
import LakeCamera from "./LakeCamera";
import WeatherChart from "./WeatherChart";
import { WindCompass, WindSpeed } from "./WindReading";
import WeatherIcon from "./WeatherIcon";
import { AttendanceFilters, ScheduledRowCards } from "./ScheduledRowCards";

export default function ForecastToday({
  weather,
  expired,
  now,
  outings,
  attendance,
  onAttendanceChange,
  onAttendance,
}: {
  weather: Forecast;
  expired: boolean;
  now: number;
  outings: Outing[];
  attendance: string[];
  onAttendanceChange: (values: string[]) => void;
  onAttendance: (outing: Outing) => void;
}) {
  const { current } = forecastSamples(weather, now);
  const today = localDateTime(new Date(now).toISOString()).slice(0, 10);
  const domain = dayBounds(today);
  const samples = windowSamples(weather, ...domain).samples;
  // Include completed rows from this calendar day, not just upcoming rows.
  const rows = outings
    .filter((o) => localDateTime(o.starts_at).startsWith(today))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const matching = rows.filter((o) =>
    attendance.includes(scheduledAttendance(o)),
  );
  const [cameraOpen, setCameraOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const row = matching.find((o) => o.id === selected) || matching[0];
  useEffect(() => {
    setSelected(row?.id || "");
  }, [row?.id]);
  const chance = current ? hourlyRainChance(weather.hours, current.time) : null;
  return (
    <>
      <section className="current-panel now-panel" aria-label="Now">
        <div className="now-heading">
          <h1>Now</h1>
          <button
            className="lake-camera-toggle"
            type="button"
            aria-label={cameraOpen ? "Hide camera" : "Show lake camera"}
            aria-expanded={cameraOpen}
            aria-controls={cameraOpen ? "lake-camera-view" : undefined}
            onClick={() => setCameraOpen(!cameraOpen)}
          >
            <Camera size={15} aria-hidden="true" />
            <span>{cameraOpen ? "Hide" : "Webcam"}</span>
          </button>
        </div>
        {current ? (
          <>
            <div className="now-conditions">
              <WindCompass direction={current.direction} />
              <div className="now-readings">
                <div className="now-wind">
                  <WindSpeed hour={current} expired={expired} />
                  <span>
                    Gusts {current.gust?.toFixed(0) ?? "—"} mph • from{" "}
                    {directionLabel(current.direction)}
                  </span>
                </div>
                <div className="now-weather">
                  <WeatherIcon code={current.code} />
                  <span>
                    {current.temperature?.toFixed(0) ?? "—"}°F •{" "}
                    {weatherDescription(current.code)} •{" "}
                    <span className="rain-chance">
                      {chance
                        ? `${chance.probability}% rain`
                        : "Rain chance unknown"}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <p>A current estimate is unavailable.</p>
        )}
        {cameraOpen && <LakeCamera />}
      </section>
      {!!rows.length && (
        <section
          className="today-scheduled"
          aria-label="Today's scheduled rows"
        >
          <div className="today-attendance">
            <AttendanceFilters
              attendance={attendance}
              onAttendanceChange={onAttendanceChange}
            />
          </div>
          {!!matching.length && (
            <ScheduledRowCards
              weather={weather}
              onAttendance={onAttendance}
              rows={matching}
              selectedRow={row?.id}
              onSelectRow={setSelected}
              expired={expired}
            />
          )}
        </section>
      )}
      <WeatherChart
        key={today}
        probabilityHours={weather.hours}
        samples={samples}
        domain={domain}
        initialTime={now}
        currentTime={now}
        expired={expired}
        title="All day"
        showTitle={false}
        highlight={
          row ? [Date.parse(row.starts_at), Date.parse(row.ends_at)] : undefined
        }
      />
    </>
  );
}
