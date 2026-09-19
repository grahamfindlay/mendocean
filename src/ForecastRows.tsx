import { useEffect, useState, type ReactNode } from "react";
import { CalendarPlus, Clock } from "lucide-react";
import {
  formatDate,
  formatTime,
  type Forecast,
  type Outing,
} from "../shared/domain";
import type {
  AssessmentCapabilities,
  AssessmentContext,
} from "../shared/model";
import { api, supabase } from "./client";
import WeatherChart from "./WeatherChart";
import { HourRow } from "./HourRow";
import { WindowReading } from "./WindowReading";
import { summarizeWindow, windowSamples } from "../shared/timeline";

const defaultContext = { route: "either", boat: "any", coach: "none" };
const emptyCapabilities: AssessmentCapabilities = { pooled: [], mine: [] };

export default function ForecastRows({
  weather,
  outings,
  now,
  expired,
  selectedRow,
  onSelectRow,
  onSchedule,
  dayView,
  userId,
}: {
  weather: Forecast;
  outings: Outing[];
  now: number;
  expired: boolean;
  selectedRow: string;
  onSelectRow: (id: string) => void;
  onSchedule: () => void;
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
  const upcoming = outings
    .filter((o) => Date.parse(o.ends_at) > now)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const row = upcoming.find((o) => o.id === selectedRow) || upcoming[0];
  const start = row ? Date.parse(row.starts_at) : NaN;
  const end = row ? Date.parse(row.ends_at) : NaN;
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
  const startsAt = row?.starts_at;
  useEffect(() => {
    let active = true;
    setEstimate(null);
    setEstimateError("");
    if (!supabase || !contexts.length || !startsAt) return;
    const timer = setTimeout(() => {
      void api<typeof estimate>("assessment", {
        // Normalized, not passed through: Postgres returns "+00:00" and the
        // endpoint's schema accepts only a "Z" suffix.
        time: new Date(startsAt).toISOString(),
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
  }, [startsAt, effectiveBasis, route, boat, coach, contexts.length, userId]);
  if (!userId)
    return (
      <>
        <section className="form-card">
          <h2>Sign in to forecast your rows</h2>
          <p>
            Scheduled rows and their forecasts need an account. Today and Week
            stay available without one.
          </p>
        </section>
        {dayView}
      </>
    );
  const selected = windowSamples(weather, start, end).samples;
  return (
    <>
      {upcoming.length ? (
        <div className="row-grid">
          {upcoming.map((o) => (
            <button
              className="row-card"
              key={o.id}
              aria-pressed={o.id === row?.id}
              onClick={() => onSelectRow(o.id)}
            >
              <span className="eyebrow">{formatDate(o.starts_at)}</span>
              <h3>{o.title}</h3>
              <span className="window-facts">
                {formatTime(o.starts_at)}–{formatTime(o.ends_at)}
              </span>
              <WindowReading
                summary={summarizeWindow(
                  weather,
                  Date.parse(o.starts_at),
                  Date.parse(o.ends_at),
                )}
                expired={expired}
              />
            </button>
          ))}
        </div>
      ) : (
        <section className="form-card">
          <h2>No rows scheduled</h2>
          <p>
            Schedule an independent row for any time and its forecast appears
            here.
          </p>
          <button className="button" onClick={onSchedule}>
            <CalendarPlus size={17} />
            Schedule independent row
          </button>
        </section>
      )}
      {row && (
        <>
          <div className="section-heading">
            <h2>{row.title}</h2>
            <span>
              <Clock size={14} /> {formatDate(row.starts_at)} ·{" "}
              {formatTime(row.starts_at)}–{formatTime(row.ends_at)}
            </span>
          </div>
          <p className="help">
            Actual samples include the row’s boundaries; values are not
            interpolated to its exact minute.
          </p>
          {!!contexts.length && (
            <section className="form-card">
              <div className="field-grid">
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
          )}
          <WeatherChart
            key={row.id}
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
                Forecast not available for this row. It may be beyond the
                forecast horizon.
              </p>
            )}
          </section>
          {estimate && estimate.source !== "heuristic" && !expired && (
            <section className="form-card assessment-result">
              <h2>What logged rows suggest</h2>
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
                Hourly weather near the row’s start · Assessment:{" "}
                {estimate.source}
              </p>
            </section>
          )}
          {estimateError && <p className="help">{estimateError}</p>}
        </>
      )}
      {dayView}
      {!!upcoming.length && (
        <div className="log-callout">
          <h2>Planning another row?</h2>
          <button className="button" onClick={onSchedule}>
            <CalendarPlus size={17} />
            Schedule independent row
          </button>
        </div>
      )}
    </>
  );
}
