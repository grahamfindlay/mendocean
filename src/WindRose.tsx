import { useId } from "react";
import { windStatus } from "../shared/domain";

// Speed bands from Hannah's wind rose; colors use the same rule as wind readings.
const bands = [
  { label: "0–5", speed: 2.5, inner: 14, outer: 42 },
  { label: "5–10", speed: 7.5, inner: 42, outer: 70 },
  { label: "10–15", speed: 12.5, inner: 70, outer: 98 },
  { label: "15+", speed: 17.5, inner: 98, outer: 126 },
];
// Exact direction boundaries, including the north-crossing sector.
const sectors = [
  [11.25, 78.75],
  [78.75, 258.75],
  [258.75, 371.25],
];
function point(degrees: number, radius: number) {
  const angle = ((degrees - 90) * Math.PI) / 180;
  return [150 + radius * Math.cos(angle), 150 + radius * Math.sin(angle)];
}
function wedge(start: number, end: number, inner: number, outer: number) {
  return `M${point(start, outer)} A${outer},${outer} 0 0 1 ${point(end, outer)} L${point(end, inner)} A${inner},${inner} 0 0 0 ${point(start, inner)} Z`;
}

export default function WindRose() {
  const id = useId();
  return (
    <figure className="wind-rose">
      <svg
        viewBox="0 0 300 300"
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
      >
        <title id={`${id}-title`}>
          Wind colors by source direction and speed
        </title>
        <desc id={`${id}-description`}>
          North is up; speed increases outward in mph. From W through N: Bussin’
          below 5, Chopped at 5 and above. From NNE through ENE: Bussin’ below
          5, Sus from 5 to below 10, Chopped at 10 and above. From E through
          WSW: Bussin’ below 10, Sus from 10 to below 15, Chopped at 15 and
          above.
        </desc>
        {bands.map((band) => (
          <g key={band.label}>
            {sectors.map(([start, end]) => (
              <path
                key={start}
                className={windStatus(band.speed, (start + end) / 2)}
                d={wedge(start, end, band.inner, band.outer)}
                fill="currentColor"
                fillOpacity=".65"
              />
            ))}
            <circle
              cx="150"
              cy="150"
              r={band.outer}
              className="wind-rose-rule"
            />
          </g>
        ))}
        {[0, 90, 180, 270].map((direction) => {
          const [x1, y1] = point(direction, 14);
          const [x2, y2] = point(direction, 126);
          return (
            <line
              key={direction}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className="wind-rose-rule"
            />
          );
        })}
        {bands.map((band) => (
          <text
            key={band.label}
            x={150 + (band.inner + band.outer) / 2}
            y="157"
            className="wind-rose-speed"
          >
            {band.label}
          </text>
        ))}
        {["N", "E", "S", "W"].map((label, index) => {
          const [x, y] = point(index * 90, 142);
          return (
            <text key={label} x={x} y={y + 4} className="wind-rose-direction">
              {label}
            </text>
          );
        })}
        <text x="150" y="153" className="wind-rose-speed">
          mph
        </text>
      </svg>
      <figcaption>
        <a href="https://hwaymentsteele.github.io/mendota-weather/">
          Hannah’s original chart
        </a>
      </figcaption>
    </figure>
  );
}
