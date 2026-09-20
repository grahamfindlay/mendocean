import { useId, useState, useEffect, useRef } from "react";
import { directionLabel, formatTime, type WeatherHour } from "../shared/domain";
import {
  hourlyRainChance,
  sampleMinutes,
  rainChanceIntervals,
  dayChartTicks,
} from "../shared/timeline";
import { weatherDescription } from "../shared/presentation";
import { WindVector } from "./WindReading";
import WeatherIcon from "./WeatherIcon";

const left = 8,
  right = 30;
/** Straight segments preserve peaks; nulls and missing time intervals break paths. */
function segments(
  samples: WeatherHour[],
  value: (h: WeatherHour) => number | null,
) {
  const runs: { h: WeatherHour; v: number }[][] = [];
  let run: { h: WeatherHour; v: number }[] = [];
  for (const h of samples) {
    const v = value(h),
      prev = run.at(-1)?.h;
    if (
      v === null ||
      (prev &&
        Date.parse(h.time) - Date.parse(prev.time) >
          Math.max(sampleMinutes(h), sampleMinutes(prev)) * 60000)
    ) {
      if (run.length) runs.push(run);
      run = [];
    }
    if (v !== null) run.push({ h, v });
  }
  if (run.length) runs.push(run);
  return runs;
}

export default function WeatherChart({
  samples,
  domain,
  initialTime,
  expired = false,
  title = "Weather over time",
  highlight,
  probabilityHours = [],
}: {
  samples: WeatherHour[];
  probabilityHours?: WeatherHour[];
  domain?: [number, number];
  initialTime?: number;
  expired?: boolean;
  title?: string;
  /** A period to mark, in epoch ms. Drawn behind the series, never inspected. */
  highlight?: [number, number];
}) {
  const id = useId();
  const surface = useRef<SVGSVGElement>(null);
  const [W, setWidth] = useState(800);
  const [selected, setSelected] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<{
    samples: WeatherHour[];
    domain: [number, number];
    probabilityHours: WeatherHour[];
  } | null>(null);
  const pointer = useRef<{
    id: number;
    x: number;
    y: number;
    dragged: boolean;
  } | null>(null);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const measure = () =>
      setWidth(Math.max(200, element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [samples.length > 0]);
  if (!samples.length && !frozen)
    return (
      <section className="weather-chart" aria-label={title}>
        <p className="chart-date">{title}</p>
        <p>Forecast samples unavailable.</p>
      </section>
    );
  const data = frozen?.samples || samples;
  const rainHours = frozen?.probabilityHours || probabilityHours;
  const [start, end] = frozen?.domain ||
    domain || [Date.parse(data[0].time), Date.parse(data.at(-1)!.time)];
  const targetTime = selected ? Date.parse(selected) : (initialTime ?? start);
  const index = Math.max(
    0,
    data.reduce(
      (last, h, i) => (Date.parse(h.time) <= targetTime ? i : last),
      0,
    ),
  );
  const h = data[index];
  const plotWidth = Math.max(1, W - left - right);
  const x = (time: string | number) =>
    left +
    (((typeof time === "number" ? time : Date.parse(time)) - start) /
      Math.max(1, end - start)) *
      plotWidth;
  const temps = data.flatMap((h) =>
    h.temperature === null ? [] : [h.temperature],
  );
  const tempMin = Math.floor(Math.min(...temps, 60) / 5) * 5;
  const tempMax = Math.ceil(Math.max(...temps, 65) / 5) * 5;
  const windMax = Math.max(
    30,
    Math.ceil(
      Math.max(...data.map((h) => Math.max(h.wind ?? 0, h.gust ?? 0))) / 10,
    ) * 10,
  );
  const chance = hourlyRainChance(rainHours, h.time);
  const rainIntervals = rainChanceIntervals(rainHours, start, end);
  const plot = (
    value: (h: WeatherHour) => number | null,
    top: number,
    height: number,
    min: number,
    max: number,
    kind: string,
    fill = false,
  ) =>
    segments(data, value).map((run, i) => {
      const y = (v: number) =>
        top + height - ((v - min) / (max - min)) * height;
      const points = run.map(({ h, v }) => `${x(h.time)},${y(v)}`).join(" L");
      return (
        <g key={i}>
          {fill && run.length > 1 && (
            <path
              className={kind + "-fill"}
              d={`M${x(run[0].h.time)},${top + height} L${points} L${x(run.at(-1)!.h.time)},${top + height} Z`}
            />
          )}
          <path className={kind} d={"M" + points} />
          {run.length === 1 && (
            <circle
              className={kind}
              cx={x(run[0].h.time)}
              cy={y(run[0].v)}
              r="2"
            />
          )}
        </g>
      );
    });
  const inspect = (clientX: number, rect: DOMRect) => {
    const target = ((clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    data.forEach((point, i) => {
      if (
        Math.abs(x(point.time) - target) <
        Math.abs(x(data[nearest].time) - target)
      )
        nearest = i;
    });
    setSelected(data[nearest].time);
  };
  // Short windows expose finer changes; wind is twice as dense as conditions.
  const hours = (end - start) / 3600000;
  const windStep = hours <= 4 ? 0.25 : hours <= 12 ? 0.5 : 1;
  const windCount = Math.max(2, Math.ceil(hours / windStep));
  const weatherCount = Math.max(2, Math.ceil(hours / (windStep * 2)));
  const vectorScale = Math.min(1, plotWidth / windCount / 26);
  const weatherScale = Math.min(1, plotWidth / weatherCount / 21);
  const annotations = (count: number) =>
    [
      ...new Set(
        Array.from({ length: count }, (_, i) => {
          const time = start + ((end - start) * (i + 0.5)) / count;
          return data.reduce((nearest, point) =>
            Math.abs(Date.parse(point.time) - time) <
            Math.abs(Date.parse(nearest.time) - time)
              ? point
              : nearest,
          );
        }),
      ),
    ].filter(
      (point) =>
        Date.parse(point.time) >= start && Date.parse(point.time) <= end,
    );
  const ticks =
    hours >= 23
      ? dayChartTicks(start, end)
      : Array.from(
          { length: W < 400 ? 3 : 5 },
          (_, i) => start + ((end - start) * i) / (W < 400 ? 2 : 4),
        );
  const cursor = Math.min(W - right, Math.max(left, x(h.time)));
  const finish = () => {
    pointer.current = null;
    setFrozen(null);
  };
  return (
    <section className="weather-chart" aria-label={title}>
      <header className="chart-header">
        <p className="chart-date">{title}</p>
        <div className="chart-reading" aria-live="polite" aria-atomic="true">
          <time dateTime={h.time}>{formatTime(h.time)}</time>
          <span className="chart-primary-reading">
            {h.wind?.toFixed(0) ?? "—"}{" "}
            <small>mph · {directionLabel(h.direction)}</small>
          </span>
          <span className="chart-secondary-reading">
            Gusts: {h.gust?.toFixed(0) ?? "—"} mph
          </span>
          <span>
            {h.temperature?.toFixed(0) ?? "—"}°F · {weatherDescription(h.code)}{" "}
            · {chance ? `${chance.probability}% rain` : "Rain chance unknown"}
          </span>
        </div>
        <div className="chart-legend">
          <span>
            <i className="wind-key" />
            Wind
          </span>
          <span>
            <i className="gust-key" />
            Gusts
          </span>
          <span>mph</span>
        </div>
      </header>
      <svg
        ref={surface}
        className="chart-surface"
        viewBox={`0 0 ${W} 440`}
        role="slider"
        tabIndex={0}
        aria-label="Forecast time"
        aria-describedby={id}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, data.length - 1)}
        aria-valuenow={index}
        aria-valuetext={`${formatTime(h.time)}, wind ${h.wind ?? "unknown"} mph, gusts ${h.gust ?? "unknown"} mph, ${h.temperature ?? "unknown"} degrees Fahrenheit, ${chance ? chance.probability + "% rain" : "rain chance unknown"}`}
        onKeyDown={(e) => {
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? data.length - 1
                : ["ArrowRight", "ArrowUp"].includes(e.key)
                  ? Math.min(data.length - 1, index + 1)
                  : ["ArrowLeft", "ArrowDown"].includes(e.key)
                    ? Math.max(0, index - 1)
                    : null;
          if (next !== null) {
            e.preventDefault();
            setSelected(data[next].time);
          }
        }}
        data-wind-max={windMax}
        data-plot-width={plotWidth}
        data-domain-start={start}
        data-domain-end={end}
        data-sample-count={data.length}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          if (pointer.current) return;
          pointer.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            dragged: false,
          };
          setFrozen({
            samples: data,
            domain: [start, end],
            probabilityHours: rainHours,
          });
          e.currentTarget.setPointerCapture(e.pointerId);
          inspect(e.clientX, e.currentTarget.getBoundingClientRect());
        }}
        onPointerMove={(e) => {
          const p = pointer.current;
          if (!p || p.id !== e.pointerId) return;
          if (
            e.pointerType !== "touch" ||
            p.dragged ||
            (Math.abs(e.clientX - p.x) > 6 &&
              Math.abs(e.clientX - p.x) > Math.abs(e.clientY - p.y))
          ) {
            p.dragged = true;
            inspect(e.clientX, e.currentTarget.getBoundingClientRect());
          }
        }}
        onPointerUp={(e) => {
          if (pointer.current?.id === e.pointerId) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            finish();
          }
        }}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      >
        <title id={id}>
          Forecast over time. Tap or drag to inspect. Use arrow keys to move
          between samples, Home for the first sample, and End for the last.
        </title>
        <defs>
          <clipPath id={id + "-plot"}>
            <rect x={left} y="0" width={plotWidth} height="400" />
          </clipPath>
        </defs>
        {highlight &&
          (() => {
            const from = Math.max(start, Math.min(end, highlight[0]));
            const to = Math.max(start, Math.min(end, highlight[1]));
            return to <= from ? null : (
              <rect
                className="chart-highlight"
                x={x(from)}
                y="0"
                width={Math.max(1, x(to) - x(from))}
                height="400"
              >
                <title>
                  Selected period:{" "}
                  {formatTime(new Date(highlight[0]).toISOString())}–
                  {formatTime(new Date(highlight[1]).toISOString())}
                </title>
              </rect>
            );
          })()}
        {ticks.map((t) => (
          <line
            key={t}
            className="chart-grid chart-time-grid"
            x1={x(t)}
            x2={x(t)}
            y1="65"
            y2="405"
          />
        ))}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              className="chart-grid"
              x1={left}
              x2={W - right}
              y1={225 - f * 150}
              y2={225 - f * 150}
            />
            <text x={W - right + 4} y={229 - f * 150}>
              {windMax * f}
            </text>
          </g>
        ))}
        <g clipPath={`url(#${id}-plot)`}>
          {plot((h) => h.gust, 75, 150, 0, windMax, "chart-gust", true)}
          {plot((h) => h.wind, 75, 150, 0, windMax, "chart-wind", true)}
          {plot((h) => h.temperature, 260, 55, tempMin, tempMax, "chart-temp")}
          {rainIntervals.map((point) => {
            const from = point.start;
            const to = point.end;
            const y = 400 - (point.probability! / 100) * 50;
            return (
              <g
                key={point.end}
                className="chart-probability-interval"
                data-probability={point.probability}
              >
                <path
                  className="chart-rain-fill"
                  d={`M${x(from)} 400V${y}H${x(to)}V400Z`}
                />
                <path className="chart-rain" d={`M${x(from)} ${y}H${x(to)}`} />
              </g>
            );
          })}
        </g>
        <text x={left} y="251">
          Temperature · °F
        </text>
        <text x={W - right + 4} y="269">
          {tempMax}
        </text>
        <text x={W - right + 4} y="318">
          {tempMin}
        </text>
        <line
          className="chart-grid"
          x1={left}
          x2={W - right}
          y1="315"
          y2="315"
        />
        <text x={left} y="339">
          Rain chance
        </text>
        <text x={W - right + 2} y="354">
          100
        </text>
        <text x={W - right + 4} y="400">
          0%
        </text>
        <line
          className="chart-grid"
          x1={left}
          x2={W - right}
          y1="400"
          y2="400"
        />
        {!rainIntervals.length && (
          <text x={left + plotWidth / 2} y="380" textAnchor="middle">
            Rain chance unavailable
          </text>
        )}
        {annotations(weatherCount).map((point) => (
          <g
            key={point.time}
            className="chart-annotation"
            transform={`translate(${x(point.time) - 10 * weatherScale},${18 - 10 * weatherScale}) scale(${weatherScale})`}
          >
            <WeatherIcon code={point.code} />
          </g>
        ))}
        {annotations(windCount).map((point) => (
          <g
            key={point.time}
            className="chart-annotation"
            transform={`translate(${x(point.time) - 16 * vectorScale},${49 - 16 * vectorScale}) scale(${vectorScale})`}
          >
            <WindVector hour={point} expired={expired} compact />
          </g>
        ))}
        <line
          x1={cursor}
          x2={cursor}
          y1="0"
          y2="405"
          className="chart-cursor"
        />
        {ticks.map((t, i) => (
          <text
            key={t}
            x={x(t)}
            y="426"
            textAnchor={
              i === 0
                ? "start"
                : i === ticks.length - 1 && hours < 23
                  ? "end"
                  : "middle"
            }
          >
            {formatTime(new Date(t).toISOString()).replace(":00", "")}
          </text>
        ))}
      </svg>
    </section>
  );
}
