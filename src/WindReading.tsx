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
          <path d="M40 59V21" stroke="currentColor" strokeWidth="3" />
          <circle cx="40" cy="21" r="4" fill="currentColor" />
        </g>
      )}
      <circle cx="40" cy="40" r="2" fill="currentColor" />
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
