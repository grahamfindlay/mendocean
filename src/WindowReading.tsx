import { directionLabel } from "../shared/domain";
import { weatherDescription } from "../shared/presentation";
import type { WindowSummary } from "../shared/timeline";

const range = (
  value: { min: number; max: number } | null,
  digits = 0,
  unit = "",
) =>
  value === null
    ? "—"
    : value.min.toFixed(digits) === value.max.toFixed(digits)
      ? `${value.min.toFixed(digits)}${unit}`
      : `${value.min.toFixed(digits)}–${value.max.toFixed(digits)}${unit}`;

/** One practice window's summary. Coverage is stated, never implied by a blank. */
export function WindowReading({
  summary,
  expired,
}: {
  summary: WindowSummary;
  expired: boolean;
}) {
  const status = expired ? "unavailable" : summary.status;
  if (!summary.samples)
    return <p className="window-empty">Forecast not available.</p>;
  return (
    <>
      <p className={`wind-speed ${status}`}>
        <span aria-hidden="true">
          {range(summary.wind)} <small>mph</small>
        </span>
        <span className="sr-only">
          Wind {range(summary.wind)} miles per hour
          {summary.gust === null
            ? ""
            : `, gusting to ${summary.gust.toFixed(0)}`}
          .
        </span>
      </p>
      <span className="window-facts">
        G{summary.gust?.toFixed(0) ?? "—"} ·{" "}
        {summary.direction === null
          ? "—"
          : summary.direction.variable
            ? "Variable"
            : directionLabel(summary.direction.bearing)}{" "}
        · {range(summary.temperature, 0, "°F")}
      </span>
      <span className="window-facts">
        {summary.probability === null
          ? "Rain chance unknown"
          : `${range(summary.probability)}% rain`}{" "}
        ·{" "}
        {/* The highest WMO code, which runs roughly clear to thunderstorm, to
            match the worst-in-window rule the status already follows. */}
        {summary.codes.length
          ? weatherDescription(Math.max(...summary.codes))
          : "Conditions unknown"}
      </span>
      {!summary.covered && (
        <span className="window-partial">
          Partial coverage · {summary.samples} samples
        </span>
      )}
    </>
  );
}
