import { useMemo } from "react";
import { formatTime, LOCATION } from "../shared/domain";
import { daylightPeriods } from "./daylight";

/** A shared time axis, with daylight kept outside the weather plotting area. */
export default function ChartDaylight({
  start,
  end,
  left,
  width,
}: {
  start: number;
  end: number;
  left: number;
  width: number;
}) {
  const periods = useMemo(() => daylightPeriods(start, end), [start, end]);
  const x = (time: number) => left + ((time - start) / (end - start)) * width;
  const timeLabel = (time: number) => formatTime(new Date(time).toISOString());
  const description = periods
    .map(
      (p) =>
        `${p.day}: sunrise ${timeLabel(p.sunrise)}, sunset ${timeLabel(p.sunset)}`,
    )
    .join(". ");
  if (!periods.length) return null;
  return (
    <g
      className="chart-daylight"
      role="img"
      aria-label={`Daylight at ${LOCATION.name}. ${description}`}
    >
      <title>{`Daylight at ${LOCATION.name}. ${description}`}</title>
      <rect
        className="chart-night-strip"
        x={left}
        y="440"
        width={width}
        height="6"
        rx="3"
      />
      {periods.map((p) => {
        const from = Math.max(start, p.sunrise);
        const to = Math.min(end, p.sunset);
        const sunriseVisible = p.sunrise >= start && p.sunrise < end;
        const sunsetVisible = p.sunset >= start && p.sunset < end;
        return (
          <g key={p.day} data-day={p.day}>
            {to > from && (
              <rect
                className="chart-daylight-strip"
                data-sunrise={p.sunrise}
                data-sunset={p.sunset}
                x={x(from)}
                y="440"
                width={x(to) - x(from)}
                height="6"
                rx="3"
              />
            )}
            {sunriseVisible && (
              <text
                className="chart-sunrise-label"
                x={Math.max(left + 58, x(p.sunrise))}
                y="463"
                textAnchor="end"
              >
                <title>{`Sunrise: ${timeLabel(p.sunrise)}`}</title>
                {timeLabel(p.sunrise)}
              </text>
            )}
            {to > from && x(to) - x(from) >= 80 && (
              <text
                className="chart-daylight-label"
                x={(x(from) + x(to)) / 2}
                y="463"
                textAnchor="middle"
              >
                Daylight
              </text>
            )}
            {sunsetVisible && (
              <text
                className="chart-sunset-label"
                x={Math.min(left + width - 58, x(p.sunset))}
                y="463"
                textAnchor="start"
              >
                <title>{`Sunset: ${timeLabel(p.sunset)}`}</title>
                {timeLabel(p.sunset)}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
