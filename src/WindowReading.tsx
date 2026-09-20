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

/** Full scheduled-row summary, with a compact presentation for Week cards. */
export function WindowReading({
  summary,
  expired,
  compact = false,
}: {
  summary: WindowSummary;
  expired: boolean;
  compact?: boolean;
}) {
  const bearing = summary.direction?.variable
    ? null
    : summary.direction?.bearing;
  const code = summary.codes.length ? Math.max(...summary.codes) : null;
  const windFacts = (
    <>
      <span aria-label={`Gusts ${summary.gust?.toFixed(0) ?? "unknown"} mph`}>
        G{summary.gust?.toFixed(0) ?? "—"}
      </span>{" "}
      •{" "}
      {summary.direction?.variable
        ? "Variable"
        : `from ${directionLabel(bearing ?? null)}`}
    </>
  );
  return (
    <span
      className={`scheduled-card-weather${compact ? " compact-window-reading" : ""}`}
    >
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
              </span>
              {!compact && <> • {windFacts}</>}
            </span>
          </span>
          {compact && <span className="compact-wind-facts">{windFacts}</span>}
          <span className="scheduled-weather-line">
            <WeatherIcon code={code} />
            <span>
              {range(summary.temperature)}°F
              {!compact && (
                <>
                  {" "}
                  • {weatherDescription(code)} •{" "}
                  {summary.probability
                    ? `${range(summary.probability)}% rain`
                    : "Rain chance unknown"}
                </>
              )}
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
