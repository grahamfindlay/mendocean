import { useId, useState, useEffect, useRef } from "react";
import {
  directionLabel,
  formatDate,
  formatTime,
  type WeatherHour,
} from "../shared/domain";
import { precipitationRate, sampleMinutes } from "../shared/timeline";
import { weatherDescription } from "../shared/presentation";
import { WindSpeed, Gust, WindVector } from "./WindReading";
import WeatherIcon from "./WeatherIcon";

const left = 48,
  right = 16;
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
}: {
  samples: WeatherHour[];
  domain?: [number, number];
  initialTime?: number;
  expired?: boolean;
  title?: string;
}) {
  const id = useId();
  const surface = useRef<SVGSVGElement>(null);
  const [W, setWidth] = useState(800);
  const [selected, setSelected] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<{
    samples: WeatherHour[];
    domain: [number, number];
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
        <h2>{title}</h2>
        <p>Forecast samples unavailable.</p>
      </section>
    );
  const data = frozen?.samples || samples;
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
  const rainMax = Math.max(0.05, ...data.map((h) => precipitationRate(h) ?? 0));
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
  const tickCount = W < 400 ? 3 : 5;
  const ticks = Array.from(
    { length: tickCount },
    (_, i) => start + ((end - start) * i) / (tickCount - 1),
  );
  const cursor = Math.min(W - right, Math.max(left, x(h.time)));
  const finish = () => {
    pointer.current = null;
    setFrozen(null);
  };
  return (
    <section className="weather-chart" aria-label={title}>
      <div className="section-heading">
        <h2>{title}</h2>
        <span>Drag or use the time slider</span>
      </div>
      <div className="chart-reading" aria-live="polite" aria-atomic="true">
        <time dateTime={h.time}>
          {formatDate(h.time)} · {formatTime(h.time)}{" "}
          {
            new Intl.DateTimeFormat("en-US", {
              timeZone: "America/Chicago",
              timeZoneName: "short",
            })
              .formatToParts(new Date(h.time))
              .find((p) => p.type === "timeZoneName")?.value
          }
        </time>
        <span>
          <WindSpeed hour={h} expired={expired} /> <Gust value={h.gust} /> ·
          From {directionLabel(h.direction)}
        </span>
        <span>
          {h.temperature?.toFixed(0) ?? "—"}°F · {weatherDescription(h.code)}
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
      <svg
        ref={surface}
        className="chart-surface"
        viewBox={`0 0 ${W} 400`}
        role="img"
        aria-labelledby={id}
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
          setFrozen({ samples: data, domain: [start, end] });
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
          Wind and gusts from 0 to 30 mph, temperature, downwind arrows, weather
          conditions, and precipitation over time. Upward triangles mark wind or
          gusts above 30 mph. Use the slider for exact values.
        </title>
        <defs>
          <clipPath id={id + "-wind"}>
            <rect x={left} y="12" width={plotWidth} height="108" />
          </clipPath>
          <clipPath id={id + "-lower"}>
            <rect x={left} y="145" width={plotWidth} height="210" />
          </clipPath>
        </defs>
        {[120, 215, 355].map((y) => (
          <line
            key={y}
            x1={left}
            x2={W - right}
            y1={y}
            y2={y}
            className="chart-grid"
          />
        ))}
        <text x="2" y="20">
          30
        </text>
        <text x="20" y="120">
          0
        </text>
        <g clipPath={`url(#${id}-wind)`}>
          {plot((h) => h.gust, 12, 108, 0, 30, "chart-gust", true)}
          {plot((h) => h.wind, 12, 108, 0, 30, "chart-wind", true)}
        </g>
        {data
          .filter(
            (h) =>
              Date.parse(h.time) >= start &&
              Date.parse(h.time) <= end &&
              Math.max(h.wind ?? 0, h.gust ?? 0) > 30,
          )
          .map((h) => (
            <path
              key={h.time}
              className="chart-overflow"
              d={`M${x(h.time) - 3} 11L${x(h.time)} 6L${x(h.time) + 3} 11Z`}
            >
              <title>
                {formatTime(h.time)}: wind {h.wind ?? "unavailable"}, gusts{" "}
                {h.gust ?? "unavailable"} mph
              </title>
            </path>
          ))}
        <text x="2" y="156">
          °F {tempMax}
        </text>
        <text x="18" y="215">
          {tempMin}
        </text>
        <g clipPath={`url(#${id}-lower)`}>
          {plot((h) => h.temperature, 150, 65, tempMin, tempMax, "chart-temp")}
          {plot(precipitationRate, 310, 45, 0, rainMax, "chart-rain", true)}
        </g>
        <text x="2" y="249">
          Wind
        </text>
        <text x="2" y="322">
          in/h
        </text>
        <text x="2" y="338">
          {rainMax.toFixed(2)}
        </text>
        {annotations(windCount).map((point) => (
          <g
            key={point.time}
            className="chart-annotation"
            transform={`translate(${x(point.time)}, 0)`}
          >
            <g
              transform={`translate(${-16 * vectorScale},${242 - 16 * vectorScale}) scale(${vectorScale})`}
            >
              <WindVector hour={point} expired={expired} />
            </g>
          </g>
        ))}
        {annotations(weatherCount).map((point) => (
          <g
            key={point.time}
            className="chart-annotation"
            transform={`translate(${x(point.time) - 10},273)`}
          >
            <WeatherIcon code={point.code} />
          </g>
        ))}
        <line
          x1={cursor}
          x2={cursor}
          y1="8"
          y2="360"
          className="chart-cursor"
        />
        {ticks.map((t, i) => (
          <text
            key={i}
            x={x(t)}
            y="383"
            textAnchor={
              i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"
            }
          >
            {formatTime(new Date(t).toISOString())}
          </text>
        ))}
      </svg>
      <label className="chart-slider">
        Inspect forecast time
        <input
          type="range"
          min="0"
          max={Math.max(0, data.length - 1)}
          value={index}
          onChange={(e) => setSelected(data[Number(e.target.value)].time)}
          aria-valuetext={`${formatDate(h.time)}, ${formatTime(h.time)}`}
        />
      </label>
    </section>
  );
}
