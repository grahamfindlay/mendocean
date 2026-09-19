import { useEffect, useState, type ReactNode } from "react";
import { Clock } from "lucide-react";
import {
  formatDate,
  formatTime,
  localDateTime,
  chicagoToISO,
  type Forecast,
  type Outing,
} from "../shared/domain";
import type {
  AssessmentCapabilities,
  AssessmentContext,
} from "../shared/model";
import { weatherDescription } from "../shared/presentation";
import { api, supabase } from "./client";
import WeatherChart from "./WeatherChart";
import { HourRow } from "./HourRow";
import {
  windowSamples,
  comparisonTimes,
  sampleMinutes,
} from "../shared/timeline";
import { Gust, WindSpeed } from "./WindReading";

const defaultContext = { route: "either", boat: "any", coach: "none" };
const emptyCapabilities: AssessmentCapabilities = { pooled: [], mine: [] };
const windowOptions = ["1", "60", "90", "120"];

export default function ForecastRows({
  weather,
  outings,
  now,
  expired,
  when,
  onSelectWhen,
  duration,
  onSelectDuration,
  onSelectDay,
  dayView,
  userId,
}: {
  weather: Forecast;
  outings: Outing[];
  now: number;
  expired: boolean;
  when: string;
  onSelectWhen: (when: string) => void;
  duration: string;
  onSelectDuration: (duration: string) => void;
  onSelectDay: (day: string) => void;
  dayView: ReactNode;
  userId?: string;
}) {
  const [basis, setBasis] = useState<"pooled" | "mine">("pooled");
  const [context, setContext] = useState<AssessmentContext>(defaultContext);
  const [capabilities, setCapabilities] = useState(emptyCapabilities);
  const [estimate, setEstimate] = useState<{
    source: string;
    reason: string | null;
    launch_probability: number | null;
    water_probabilities: number[] | null;
    outings: number;
  } | null>(null);
  const [estimateError, setEstimateError] = useState("");
  useEffect(() => {
    let active = true;
    setCapabilities(emptyCapabilities);
    setBasis("pooled");
    setContext(defaultContext);
    if (supabase)
      void api<AssessmentCapabilities>("assessment/capabilities")
        .then((v) => {
          if (active) setCapabilities(v);
        })
        .catch(() => {
          /* Weather remains useful if model metadata is unavailable. */
        });
    return () => {
      active = false;
    };
  }, [userId]);
  const effectiveBasis = capabilities[basis].length
    ? basis
    : capabilities.pooled.length
      ? "pooled"
      : "mine";
  const contexts = capabilities[effectiveBasis];
  const effectiveContext =
    contexts.find((c) => JSON.stringify(c) === JSON.stringify(context)) ||
    contexts[0] ||
    defaultContext;
  const { route, boat, coach } = effectiveContext;
  useEffect(() => {
    let active = true;
    setEstimate(null);
    setEstimateError("");
    if (!supabase || !contexts.length) return;
    const timer = setTimeout(() => {
      let time: string;
      try {
        time = chicagoToISO(when);
      } catch {
        return;
      }
      void api<typeof estimate>("assessment", {
        time,
        basis: effectiveBasis,
        route,
        boat,
        coach,
      })
        .then((v) => {
          if (active) setEstimate(v);
        })
        .catch((e) => {
          if (active) setEstimateError(e.message);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [when, effectiveBasis, route, boat, coach, contexts.length, userId]);
  let start = NaN;
  try {
    start = Date.parse(chicagoToISO(when));
  } catch {
    /* Input validation below. */
  }
  const window = windowSamples(
    weather,
    start,
    start + (Number(duration) === 1 ? 0 : Number(duration) * 60000),
  );
  const selected = window.samples;
  const comparisons = comparisonTimes(weather, when, now);
  return (
    <>
      <section className="form-card">
        <div className="field-grid">
          <label>
            Start time · Madison
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => onSelectWhen(e.target.value)}
            />
          </label>
          <label>
            Window
            <select
              value={duration}
              onChange={(e) => onSelectDuration(e.target.value)}
            >
              <option value="1">Point forecast</option>
              <option value="60">1 hour</option>
              <option value="90">90 minutes</option>
              <option value="120">2 hours</option>
              {!windowOptions.includes(duration) && (
                <option value={duration}>{duration} minutes</option>
              )}
            </select>
          </label>
          {!!capabilities.mine.length && (
            <label>
              Use observations
              <select
                value={effectiveBasis}
                onChange={(e) => setBasis(e.target.value as "pooled" | "mine")}
              >
                {!!capabilities.pooled.length && (
                  <option value="pooled">Everyone’s data</option>
                )}
                <option value="mine">Only my data</option>
              </select>
            </label>
          )}
          {(["route", "boat", "coach"] as const).map((field) => {
            const options = [...new Set(contexts.map((c) => c[field]))];
            if (
              options.length < 2 &&
              (!options[0] || options[0] === defaultContext[field])
            )
              return null;
            return (
              <label key={field}>
                {{ route: "Route", boat: "Boat", coach: "Coach factor" }[field]}
                <select
                  value={effectiveContext[field]}
                  onChange={(e) => {
                    const matches = contexts.filter(
                      (c) => c[field] === e.target.value,
                    );
                    matches.sort((a, b) =>
                      Object.keys(defaultContext).reduce(
                        (score, key) =>
                          score +
                          Number(
                            b[key as keyof AssessmentContext] ===
                              effectiveContext[key as keyof AssessmentContext],
                          ) -
                          Number(
                            a[key as keyof AssessmentContext] ===
                              effectiveContext[key as keyof AssessmentContext],
                          ),
                        0,
                      ),
                    );
                    setContext(matches[0]);
                  }}
                >
                  {options.map((v) => (
                    <option key={v} value={v}>
                      {(
                        {
                          either: "Either direction",
                          any: "Any boat",
                          none: "No coach factor",
                          east: "East",
                          west: "West",
                          uncoached: "Uncoached",
                        } as Record<string, string>
                      )[v] || v}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </section>
      <div className="section-heading">
        <h2>Your selected window</h2>
        <span>
          <Clock size={14} />{" "}
          {Number(duration) === 1
            ? "Samples at or around the selected time"
            : duration + " minutes"}
        </span>
      </div>
      <p className="help">
        {Number.isFinite(start) &&
          `${formatDate(new Date(start).toISOString())} · ${formatTime(new Date(start).toISOString())}${Number(duration) === 1 ? "" : `–${formatDate(new Date(start + Number(duration) * 60000).toISOString())}, ${formatTime(new Date(start + Number(duration) * 60000).toISOString())}`}. `}
        Actual samples include the selection’s boundaries; values are not
        interpolated to your chosen minute.
      </p>
      {!window.covered && (
        <p className="alert">
          Full forecast coverage is unavailable for this selection. Available
          samples are shown below.
        </p>
      )}
      <WeatherChart
        key={when + duration}
        samples={selected}
        expired={expired}
        title="Selected forecast"
      />
      <section className="hour-table">
        {selected.length ? (
          selected.map((h) => (
            <HourRow
              key={h.time}
              hour={h}
              hours={weather.hours}
              expired={expired}
            />
          ))
        ) : (
          <p className="empty">
            {Number.isFinite(start)
              ? "Forecast not available for this selection."
              : "Choose a valid Madison date and time."}
          </p>
        )}
      </section>
      {estimate && estimate.source !== "heuristic" && !expired && (
        <section className="form-card assessment-result">
          <h2>What logged rows suggest</h2>
          {estimate.launch_probability !== null && (
            <p>
              {Math.round(estimate.launch_probability * 100)}% estimated rowing
              rate in similar conditions.
            </p>
          )}
          {estimate.water_probabilities && (
            <p>
              Water ratings:{" "}
              {estimate.water_probabilities
                .map((p, i) => `${i + 1}: ${Math.round(p * 100)}%`)
                .join(" · ")}
            </p>
          )}
          <p className="help">
            Based on {estimate.outings} distinct outings ·{" "}
            {effectiveBasis === "mine" ? "Only your data" : "Pooled data"} ·
            Hourly weather near selected start · Assessment: {estimate.source}
          </p>
        </section>
      )}
      {estimateError && <p className="help">{estimateError}</p>}
      <div className="section-heading">
        <h2>Five days at {when.slice(11)}</h2>
        <span>Select a day for its timeline</span>
      </div>
      <div className="comparison-grid">
        {comparisons.map((c) => (
          <article key={c.day}>
            <button className="text-button" onClick={() => onSelectDay(c.day)}>
              {formatDate(c.day + "T12:00:00Z")}
            </button>
            {c.covered ? (
              c.samples.map((h) => (
                <div key={h.time}>
                  <small>
                    {formatTime(h.time)} · {sampleMinutes(h)} min
                  </small>
                  <p>
                    <WindSpeed hour={h} expired={expired} />{" "}
                    <Gust value={h.gust} />
                  </p>
                  <span>
                    {h.temperature ?? "—"}°F · {weatherDescription(h.code)}
                  </span>
                </div>
              ))
            ) : (
              <p>Forecast not available.</p>
            )}
          </article>
        ))}
      </div>
      {dayView}
      {outings.some((o) => Date.parse(o.ends_at) > now) && (
        <>
          <div className="section-heading">
            <h2>Your upcoming rows</h2>
          </div>
          <div className="outing-grid">
            {outings
              .filter((o) => Date.parse(o.ends_at) > now)
              .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
              .map((o) => (
                <button
                  className="outing-card"
                  key={o.id}
                  onClick={() => {
                    onSelectWhen(localDateTime(o.starts_at));
                    onSelectDuration(
                      String(
                        Math.max(
                          1,
                          Math.round(
                            (Date.parse(o.ends_at) - Date.parse(o.starts_at)) /
                              60000,
                          ),
                        ),
                      ),
                    );
                  }}
                >
                  <span className="eyebrow">{formatDate(o.starts_at)}</span>
                  <h3>{o.title}</h3>
                  <p>
                    {formatTime(o.starts_at)}–{formatTime(o.ends_at)}
                  </p>
                </button>
              ))}
          </div>
        </>
      )}
    </>
  );
}
