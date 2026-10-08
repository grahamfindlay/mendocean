import { formatTime, type Outing } from "../shared/domain";
function reading(w: {
  wind: number | null;
  gust: number | null;
  direction: number | null;
  temperature: number | null;
}) {
  return [
    w.wind === null ? "Wind unavailable" : `${w.wind.toFixed(1)} mph wind`,
    w.gust === null ? "gust unavailable" : `${w.gust.toFixed(1)} mph gust`,
    w.direction === null
      ? "direction unavailable"
      : `${Math.round(w.direction)}°`,
    w.temperature === null
      ? "temperature unavailable"
      : `${w.temperature.toFixed(1)}°F`,
  ].join(" · ");
}
export function MeasuredConditions({ outing }: { outing: Outing }) {
  const data = outing.measured_conditions;
  if (!data) return null;
  return (
    <details className="history-reminder-details">
      <summary>Forecast & measured conditions</summary>
      <div className="reminder-details">
        {data.forecast ? (
          <p>
            <strong>
              {data.forecast_source_kind === "archived_forecast"
                ? "Forecast collected before the row"
                : "Historical forecast · advance availability unverified"}
            </strong>
            <br />
            {reading(data.forecast)}
            {data.forecast.forecast_received_at && (
              <> · Collected {formatTime(data.forecast.forecast_received_at)}</>
            )}
          </p>
        ) : (
          <p>Forecast unavailable.</p>
        )}
        {data.sources.map((source) => (
          <p key={source.source}>
            <strong>{source.label}</strong>
            <br />
            {source.bins ? (
              <>
                {reading(source)}
                <br />
                Reports in {source.bins} of {source.expected_bins} time windows.
                Latest measurement{" "}
                {source.latest_observed_at &&
                  formatTime(source.latest_observed_at)}
                .
                {source.max_delivery_delay_minutes !== null &&
                  source.max_delivery_delay_minutes > 30 && (
                    <>
                      {" "}
                      Some readings arrived{" "}
                      {Math.round(source.max_delivery_delay_minutes)} minutes
                      later.
                    </>
                  )}
                {source.flags.includes("gust_below_wind") && (
                  <> Provider reported a gust below sustained wind.</>
                )}
              </>
            ) : (
              "Measurements unavailable for this row."
            )}
          </p>
        ))}
        <p className="help">
          Sources measure different locations and averaging periods. Boundary
          windows may extend outside the row.
        </p>
        {data.sources.some((s) => s.source === "vc_jmp" && s.bins > 0) && (
          <p className="help">
            Weather data by{" "}
            <a
              href="https://www.visualcrossing.com/"
              target="_blank"
              rel="noreferrer"
            >
              Visual Crossing
            </a>
            .
          </p>
        )}
      </div>
    </details>
  );
}
