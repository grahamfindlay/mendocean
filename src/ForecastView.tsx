import { useEffect, useState } from "react";
import { ArrowRight, Clock } from "lucide-react";
import {
  directionLabel,
  formatDate,
  formatTime,
  localDateTime,
  chicagoToISO,
  weatherFreshness,
  type Forecast,
  type WeatherHour,
  type Outing,
} from "../shared/domain";
import type {
  AssessmentCapabilities,
  AssessmentContext,
} from "../shared/model";
import { forecastSamples, weatherDescription } from "../shared/presentation";
import { api, supabase } from "./client";
import WeatherChart from "./WeatherChart";
import {
  timelineSamples,
  nearTerm,
  windowSamples,
  forecastDays,
  comparisonTimes,
  sampleMinutes,
} from "../shared/timeline";
import { Gust, WindCompass, WindSpeed } from "./WindReading";

export function HourRow({
  hour,
  expired = false,
}: {
  hour: WeatherHour;
  expired?: boolean;
}) {
  return (
    <details className="hour-detail">
      <summary className="hour-row">
        <time dateTime={hour.time}>{formatTime(hour.time)}</time>
        <span className="wind-cell">
          <WindSpeed hour={hour} expired={expired} />
          <span className="wind-direction">
            From {directionLabel(hour.direction)}
          </span>
        </span>
        <Gust value={hour.gust} />
        <span>{hour.temperature?.toFixed(0) ?? "—"}°F</span>
        <span className="weather-description">
          {weatherDescription(hour.code)}
        </span>
      </summary>
      <div className="hour-more">
        <span>
          Conditions <b>{weatherDescription(hour.code)}</b>
        </span>
        <span>
          Gusts <b>{hour.gust?.toFixed(1) ?? "—"} mph</b>
        </span>
        <span>
          Rain chance <b>{hour.probability ?? "—"}%</b>
        </span>
        <span>
          Preceding {sampleMinutes(hour)} min precipitation{" "}
          <b>{hour.precipitation ?? "—"} in</b>
        </span>
        <span>
          Visibility{" "}
          <b>
            {hour.visibility == null
              ? "—"
              : (hour.visibility / 1609.344).toFixed(1)}{" "}
            mi
          </b>
        </span>
      </div>
    </details>
  );
}
export interface ForecastSelection {
  starts_at: string;
  ends_at: string;
  id: string;
}
const defaultContext = { route: "either", boat: "any", coach: "none" };
const emptyCapabilities: AssessmentCapabilities = { pooled: [], mine: [] };
export default function ForecastView({
  weather,
  tab,
  outings,
  onLog,
  now,
  selection,
  userId,
}: {
  weather: Forecast;
  tab: string;
  outings: Outing[];
  onLog: () => void;
  now: number;
  selection?: ForecastSelection;
  userId?: string;
}) {
  const [when, setWhen] = useState(
    localDateTime(new Date(Date.now() + 86400000).toISOString()).slice(0, 11) +
      "07:00",
  );
  const [selectedDay, setSelectedDay] = useState("");
  const [duration, setDuration] = useState("90");
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
    if (selection) {
      setWhen(localDateTime(selection.starts_at));
      setDuration(
        String(
          Math.max(
            1,
            Math.round(
              (Date.parse(selection.ends_at) -
                Date.parse(selection.starts_at)) /
                60000,
            ),
          ),
        ),
      );
    }
  }, [selection]);
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
    if (tab !== "Forecast" || !supabase || !contexts.length) return;
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
  }, [tab, when, effectiveBasis, route, boat, coach, contexts.length, userId]);
  const fresh = weatherFreshness(weather.fetched_at, now);
  const expired = fresh === "expired";
  const { upcoming, current } = forecastSamples(weather, now);
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
  const days = forecastDays(weather, now);
  const day = days.includes(selectedDay) ? selectedDay : days[0];
  const daySamples = timelineSamples(weather).filter((h) =>
    localDateTime(h.time).startsWith(day),
  );
  const near = nearTerm(weather, now);
  const comparisons = comparisonTimes(weather, when, now);
  const dayView = (
    <>
      <div className="day-picker" role="group" aria-label="Forecast day">
        {days.map((d) => (
          <button
            key={d}
            aria-pressed={day === d}
            onClick={() => setSelectedDay(d)}
          >
            {formatDate(d + "T12:00:00Z")}
          </button>
        ))}
      </div>
      <WeatherChart
        key={day}
        samples={daySamples}
        expired={expired}
        title={day ? formatDate(day + "T12:00:00Z") : "Daily forecast"}
      />
      <details className="sample-details">
        <summary>All samples for this day</summary>
        <div className="hour-table">
          {daySamples.map((h) => (
            <HourRow key={h.time} hour={h} expired={expired} />
          ))}
        </div>
      </details>
    </>
  );
  const windowOptions = ["1", "60", "90", "120"];
  return (
    <>
      <div className="page-heading concise-heading">
        <div>
          <h1>{tab}</h1>
          {tab === "Forecast" && (
            <p>Choose a date and time, or an outing, to see its forecast.</p>
          )}
        </div>
      </div>
      {fresh !== "fresh" && (
        <div className="alert">
          {expired
            ? "This forecast has expired. Wind colors are unavailable until a fresh forecast arrives."
            : "This forecast is more than two hours old. Conditions may have changed."}
        </div>
      )}
      {tab === "Now" && (
        <>
          {current ? (
            <section className="current-panel">
              <div className="current-weather">
                <p className="eyebrow">JAMES MADISON PARK</p>
                <p className="valid-time">
                  {weather.current?.time === current.time
                    ? "Current estimate"
                    : sampleMinutes(current) === 15
                      ? "15-minute estimate"
                      : "Hourly estimate"}{" "}
                  for{" "}
                  <time dateTime={current.time}>
                    {formatTime(current.time)}
                  </time>
                </p>
                <div className="current-wind">
                  <WindCompass direction={current.direction} />
                  <div>
                    <WindSpeed hour={current} expired={expired} />
                    <p>
                      From {directionLabel(current.direction)}
                      {current.direction !== null &&
                        ` (${Math.round(current.direction)}°)`}
                    </p>
                  </div>
                </div>
                <div className="weather-facts">
                  <span>
                    Gusts <b>{current.gust?.toFixed(0) ?? "—"} mph</b>
                  </span>
                  <span>
                    Air <b>{current.temperature?.toFixed(0) ?? "—"}°F</b>
                  </span>
                  <span>
                    {`Precipitation · ${weather.current?.time === current.time ? 15 : sampleMinutes(current)} min`}{" "}
                    <b>{current.precipitation ?? "—"} in</b>
                  </span>
                </div>
                <p className="current-description">
                  {weatherDescription(current.code)}
                </p>
              </div>
            </section>
          ) : (
            <p className="empty">
              A current estimate is unavailable. Upcoming forecasts are shown
              below.
            </p>
          )}
          <div className="section-heading">
            <h2>The next few hours</h2>
            <span>15-minute steps where available, then hourly</span>
          </div>
          <WeatherChart
            samples={[
              ...(current ? [current] : []),
              ...near.filter((h) => Date.parse(h.time) <= now + 2 * 3600000),
            ]}
            expired={expired}
            title="Your next two hours"
          />
          <section className="hour-table">
            {near.map((h) => (
              <HourRow key={h.time} hour={h} expired={expired} />
            ))}
            {!upcoming.length && (
              <p className="empty">No upcoming forecast is available.</p>
            )}
          </section>
          <div className="log-callout">
            <h2>How was the water?</h2>
            <button className="button" onClick={onLog}>
              Log a row <ArrowRight size={17} />
            </button>
          </div>
        </>
      )}
      {tab === "Hourly" && dayView}
      {tab === "Forecast" && (
        <>
          <section className="form-card">
            <div className="field-grid">
              <label>
                Start time · Madison
                <input
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                />
              </label>
              <label>
                Window
                <select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
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
                    onChange={(e) =>
                      setBasis(e.target.value as "pooled" | "mine")
                    }
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
                    {
                      { route: "Route", boat: "Boat", coach: "Coach factor" }[
                        field
                      ]
                    }
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
                                  effectiveContext[
                                    key as keyof AssessmentContext
                                  ],
                              ) -
                              Number(
                                a[key as keyof AssessmentContext] ===
                                  effectiveContext[
                                    key as keyof AssessmentContext
                                  ],
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
              Full forecast coverage is unavailable for this selection.
              Available samples are shown below.
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
                <HourRow key={h.time} hour={h} expired={expired} />
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
              <h2>What logged outings suggest</h2>
              {estimate.launch_probability !== null && (
                <p>
                  {Math.round(estimate.launch_probability * 100)}% estimated
                  rowing rate in similar conditions.
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
                Hourly weather near selected start · Assessment:{" "}
                {estimate.source}
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
                <button
                  className="text-button"
                  onClick={() => setSelectedDay(c.day)}
                >
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
                <h2>Your upcoming outings</h2>
              </div>
              <div className="outing-grid">
                {outings
                  .filter((o) => Date.parse(o.ends_at) > now)
                  .sort(
                    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at),
                  )
                  .map((o) => (
                    <button
                      className="outing-card"
                      key={o.id}
                      onClick={() => {
                        setWhen(localDateTime(o.starts_at));
                        setDuration(
                          String(
                            Math.max(
                              1,
                              Math.round(
                                (Date.parse(o.ends_at) -
                                  Date.parse(o.starts_at)) /
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
      )}
      <p className="help">
        {weather.resolution_note ||
          "Hourly model estimates; 15-minute data are not available in this cached forecast."}
      </p>
      <aside className="method-note">
        <span>
          Weather: <a href="https://open-meteo.com/">{weather.provider}</a> ·
          Updated {formatDate(weather.fetched_at)},{" "}
          {formatTime(weather.fetched_at)}
        </span>
        <details>
          <summary>Wind colors: Hannah’s heuristic</summary>
          <p>Version: {weather.model_version}</p>
          <p className="wind-key">
            <span className="favorable">○ Below threshold</span>
            <span className="caution">△ Intermediate range</span>
            <span className="unfavorable">◇ Above threshold</span>
          </p>
          <p>
            Thresholds depend on wind direction. Wind colors describe the
            heuristic, not measured water conditions.
          </p>
        </details>
      </aside>
    </>
  );
}
