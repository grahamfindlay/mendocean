import { useId, useState, useEffect, useRef } from "react";
import {
  directionLabel,
  formatDate,
  formatTime,
  type WeatherHour,
} from "../shared/domain";
import { precipitationRate, sampleMinutes } from "../shared/timeline";
import { weatherDescription } from "../shared/presentation";
import { WindSpeed, Gust } from "./WindReading";

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
  expired = false,
  title = "Weather over time",
}: {
  samples: WeatherHour[];
  expired?: boolean;
  title?: string;
}) {
  const id = useId();
  const surface = useRef<SVGSVGElement>(null);
  const [W, setWidth] = useState(800);
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
  const [selected, setSelected] = useState<string | null>(null);
  if (!samples.length) return null;
  const index = Math.max(
    0,
    samples.findIndex((h) => h.time === selected),
  );
  const h = samples[index],
    start = Date.parse(samples[0].time),
    end = Date.parse(samples.at(-1)!.time);
  const x = (time: string) =>
    left +
    ((Date.parse(time) - start) / Math.max(1, end - start)) *
      (W - left - right);
  const windMax = Math.ceil(
    Math.max(5, ...samples.flatMap((h) => [h.wind ?? 0, h.gust ?? 0])),
  );
  const temps = samples.flatMap((h) =>
    h.temperature === null ? [] : [h.temperature],
  );
  const tempMin = Math.floor(Math.min(...temps, 60) / 5) * 5,
    tempMax = Math.ceil(Math.max(...temps, 65) / 5) * 5;
  const rainMax = Math.max(
    0.05,
    ...samples.map((h) => precipitationRate(h) ?? 0),
  );
  const plot = (
    value: (h: WeatherHour) => number | null,
    top: number,
    height: number,
    min: number,
    max: number,
    kind: string,
    fill = false,
  ) =>
    segments(samples, value).map((run, i) => {
      const points = run
        .map(
          ({ h, v }) =>
            `${x(h.time)},${top + height - ((v - min) / (max - min)) * height}`,
        )
        .join(" L");
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
              cy={top + height - ((run[0].v - min) / (max - min)) * height}
              r="2"
            />
          )}
        </g>
      );
    });
  const inspect = (clientX: number, rect: DOMRect) => {
    const target = ((clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    samples.forEach((h, i) => {
      if (
        Math.abs(x(h.time) - target) <
        Math.abs(x(samples[nearest].time) - target)
      )
        nearest = i;
    });
    setSelected(samples[nearest].time);
  };
  const ticks = [
    ...new Set([
      0,
      Math.round((samples.length - 1) / 3),
      Math.round((2 * (samples.length - 1)) / 3),
      samples.length - 1,
    ]),
  ];
  return (
    <section className="weather-chart" aria-label={title}>
      <div className="section-heading">
        <h2>{title}</h2>
        <span>Tap or use the time slider</span>
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
        viewBox={`0 0 ${W} 380`}
        role="img"
        aria-labelledby={id}
        onPointerDown={(e) =>
          inspect(e.clientX, e.currentTarget.getBoundingClientRect())
        }
      >
        <title id={id}>
          Wind and gusts, temperature, wind from direction, and precipitation
          over time. Use the slider or sample list for exact values.
        </title>
        {[120, 220, 320].map((y) => (
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
          {Math.ceil(windMax)}
        </text>
        <text x="20" y="120">
          0
        </text>
        {plot((h) => h.gust, 12, 108, 0, windMax, "chart-gust", true)}
        {plot((h) => h.wind, 12, 108, 0, windMax, "chart-wind", true)}
        <text x="2" y="155">
          °F {tempMax}
        </text>
        <text x="18" y="220">
          {tempMin}
        </text>
        {plot((h) => h.temperature, 150, 70, tempMin, tempMax, "chart-temp")}
        <text x="2" y="249">
          From
        </text>
        {ticks.map((i) => (
          <text key={i} x={x(samples[i].time)} y="249" textAnchor="middle">
            {directionLabel(samples[i].direction)}
          </text>
        ))}
        <text x="2" y="277">
          in/h
        </text>
        <text x="2" y="290">
          {rainMax.toFixed(2)}
        </text>
        <text x="20" y="320">
          0
        </text>
        {plot(precipitationRate, 275, 45, 0, rainMax, "chart-rain", true)}
        <line
          x1={x(h.time)}
          x2={x(h.time)}
          y1="8"
          y2="328"
          className="chart-cursor"
        />
        {ticks.map((i) => (
          <text
            key={i}
            x={x(samples[i].time)}
            y="355"
            textAnchor={
              i === 0 ? "start" : i === samples.length - 1 ? "end" : "middle"
            }
          >
            {formatTime(samples[i].time)}
          </text>
        ))}
      </svg>
      <label className="chart-slider">
        Inspect forecast time
        <input
          type="range"
          min="0"
          max={Math.max(0, samples.length - 1)}
          value={index}
          onChange={(e) => setSelected(samples[Number(e.target.value)].time)}
          aria-valuetext={`${formatDate(h.time)}, ${formatTime(h.time)}`}
        />
      </label>
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
          From {directionLabel(h.direction)}{" "}
          {h.direction === null ? "" : `(${Math.round(h.direction)}°)`}
        </span>
        <span>
          {h.temperature ?? "—"}°F · {weatherDescription(h.code)}
        </span>
        <span>
          Precipitation: {h.precipitation ?? "—"} in / preceding{" "}
          {sampleMinutes(h)} min · Mean rate{" "}
          {precipitationRate(h)?.toFixed(2) ?? "—"} in/h
        </span>
        {h.probability !== null && (
          <span>Hourly rain chance: {h.probability}%</span>
        )}
      </div>
      <p className="help">
        {[...new Set(samples.map(sampleMinutes))]
          .sort((a, b) => a - b)
          .join(" / ")}
        -minute samples. Lines join model estimates; gaps mean missing data.
        Rain is shown as mean rate to compare different intervals.
      </p>
    </section>
  );
}
