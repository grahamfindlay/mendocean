import { directionLabel } from "../shared/domain";
import { weatherDescription } from "../shared/presentation";
import type { WindowSummary } from "../shared/timeline";
import WeatherIcon from "./WeatherIcon";

const range = (value: { min: number; max: number } | null) =>
  !value
    ? "—"
    : Math.round(value.min) === Math.round(value.max)
      ? String(Math.round(value.min))
      : `${Math.round(value.min)}–${Math.round(value.max)}`;

/** Shared two-line weather summary for scheduled rows and Week cards. */
export function WindowReading({
  summary,
  expired,
}: {
  summary: WindowSummary;
  expired: boolean;
}) {
  const bearing = summary.direction?.variable
    ? null
    : summary.direction?.bearing;
  const code = summary.codes.length ? Math.max(...summary.codes) : null;
  return (
    <span className="scheduled-card-weather">
      {!summary.samples ? (
        <span>Forecast not available.</span>
      ) : (
        <>
          <span className="scheduled-weather-line">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              role="img"
              aria-label={
                bearing == null
                  ? "Wind direction unavailable or variable"
                  : `Wind from ${directionLabel(bearing)}`
              }
            >
              {bearing == null ? (
                <text x="12" y="17" textAnchor="middle">
                  —
                </text>
              ) : (
                <path
                  d="M12 3V21 M6 15L12 21L18 15"
                  transform={`rotate(${bearing} 12 12)`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              )}
            </svg>
            <span>
              <span
                className={`wind-speed ${expired ? "unavailable" : summary.status}`}
              >
                {range(summary.wind)} mph
              </span>{" "}
              • G{summary.gust?.toFixed(0) ?? "—"} •{" "}
              {summary.direction?.variable
                ? "Variable"
                : `from ${directionLabel(bearing ?? null)}`}
            </span>
          </span>
          <span className="scheduled-weather-line">
            <WeatherIcon code={code} />
            <span>
              {range(summary.temperature)}°F • {weatherDescription(code)} •{" "}
              {summary.probability
                ? `${range(summary.probability)}% rain`
                : "Rain chance unknown"}
            </span>
          </span>
          {!summary.covered && (
            <span className="window-partial">Partial forecast coverage</span>
          )}
        </>
      )}
    </span>
  );
}
