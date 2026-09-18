import { directionLabel, windStatus, type WeatherHour } from "../shared/domain";

export function WindCompass({ direction }: { direction: number | null }) {
  const valid = direction !== null && Number.isFinite(direction);
  return (
    <svg
      className="wind-compass"
      viewBox="0 0 80 80"
      role="img"
      aria-label={
        valid
          ? `Wind from ${directionLabel(direction)} (${Math.round(direction)}°)`
          : "Wind direction unavailable"
      }
    >
      <circle
        cx="40"
        cy="40"
        r="37"
        fill="none"
        stroke="currentColor"
        opacity=".3"
      />
      <g className="compass-labels">
        <text x="40" y="14">
          N
        </text>
        <text x="68" y="43">
          E
        </text>
        <text x="40" y="73">
          S
        </text>
        <text x="12" y="43">
          W
        </text>
      </g>
      {valid && (
        <g transform={`rotate(${direction} 40 40)`} className="compass-bearing">
          <path
            d="M40 21V59 M34 51L40 59L46 51"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
          <circle cx="40" cy="21" r="4" fill="currentColor" />
        </g>
      )}
      <circle cx="40" cy="40" r="2" fill="currentColor" />
    </svg>
  );
}
/** A north wind travels south: SVG's unrotated arrow points down. */
export function WindVector({
  hour,
  expired = false,
}: {
  hour: WeatherHour;
  expired?: boolean;
}) {
  const calm = hour.wind === 0;
  const valid =
    hour.wind !== null &&
    hour.direction !== null &&
    Number.isFinite(hour.wind) &&
    Number.isFinite(hour.direction);
  const status = expired
    ? "unavailable"
    : windStatus(hour.wind, hour.direction);
  const length = 10 + (Math.min(30, Math.max(0, hour.wind ?? 0)) / 30) * 14;
  return (
    <svg
      className={`wind-vector ${status}`}
      width="32"
      height="32"
      viewBox="0 0 32 32"
      role="img"
      aria-label={
        calm
          ? "Calm wind"
          : valid
            ? `Wind from ${directionLabel(hour.direction)}, ${hour.wind!.toFixed(1)} mph. ${classification[status]}.`
            : "Wind direction or speed unavailable"
      }
    >
      {calm ? (
        <circle cx="16" cy="16" r="3" fill="none" stroke="currentColor" />
      ) : valid ? (
        <g transform={`rotate(${hour.direction} 16 16)`}>
          <path
            d={`M16 ${16 - length / 2}V${16 + length / 2} M12 ${12 + length / 2}L16 ${16 + length / 2}L20 ${12 + length / 2}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
        </g>
      ) : (
        <text x="16" y="21" textAnchor="middle">
          —
        </text>
      )}
    </svg>
  );
}
const classification = {
  favorable: "Below Hannah’s wind threshold",
  caution: "Within Hannah’s intermediate wind range",
  unfavorable: "Above Hannah’s wind threshold",
  unavailable: "Wind classification unavailable",
};
export function WindSpeed({
  hour,
  expired = false,
}: {
  hour: WeatherHour;
  expired?: boolean;
}) {
  const status = expired
    ? "unavailable"
    : windStatus(hour.wind, hour.direction);
  return (
    <span className={`wind-speed ${status}`}>
      <span aria-hidden="true">
        {hour.wind?.toFixed(1) ?? "—"} <small>mph</small>
      </span>
      <span className="sr-only">
        {hour.wind === null
          ? "Wind speed unavailable"
          : `${hour.wind.toFixed(1)} mph`}
        . {classification[status]}.
      </span>
    </span>
  );
}
export function Gust({ value }: { value: number | null }) {
  return (
    <span
      className="gust-reading"
      aria-label={
        value === null ? "Gusts unavailable" : `Gusts ${Math.round(value)} mph`
      }
      title="Gusts in mph"
    >
      G{value?.toFixed(0) ?? "—"}
    </span>
  );
}
