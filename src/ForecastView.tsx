import { useEffect, useState } from "react";
import { ArrowDown, ArrowRight, Clock, Wind } from "lucide-react";
import {
  BOAT_CLASSES,
  STATUS_LABELS,
  directionLabel,
  formatDate,
  formatTime,
  localDateTime,
  chicagoToISO,
  weatherFreshness,
  windStatus,
  type Forecast,
  type WeatherHour,
  type Outing,
} from "../shared/domain";
import { api, supabase } from "./client";
export function HourRow({
  hour,
  expired = false,
}: {
  hour: WeatherHour;
  expired?: boolean;
}) {
  const status = expired
    ? "unavailable"
    : windStatus(hour.wind, hour.direction);
  return (
    <details className="hour-detail">
      <summary className="hour-row">
        <time dateTime={hour.time}>{formatTime(hour.time)}</time>
        <span className={"condition " + status}>
          <i />
          {STATUS_LABELS[status]}
        </span>
        <span className="wind-cell">
          <ArrowDown
            size={16}
            style={{ transform: `rotate(${hour.direction ?? 0}deg)` }}
          />
          {hour.wind?.toFixed(1) ?? "—"}{" "}
          <small>mph {directionLabel(hour.direction)}</small>
          <small className="mobile-gust">
            Gust {hour.gust?.toFixed(0) ?? "—"} mph
          </small>
        </span>
        <span className="gust-cell">
          {hour.gust?.toFixed(0) ?? "—"} <small>gust</small>
        </span>
        <span>{hour.temperature?.toFixed(0) ?? "—"}°</span>
      </summary>
      <div className="hour-more">
        <span>
          Gusts <b>{hour.gust?.toFixed(1) ?? "—"} mph</b>
        </span>
        <span>
          Air <b>{hour.temperature?.toFixed(0) ?? "—"}°F</b>
        </span>
        <span>
          Rain chance <b>{hour.probability ?? "—"}%</b>
        </span>
        <span>
          Precipitation <b>{hour.precipitation ?? "—"} in</b>
        </span>
        <span>
          Visibility{" "}
          <b>
            {hour.visibility === null
              ? "—"
              : (hour.visibility / 1609.344).toFixed(1)}{" "}
            mi
          </b>
        </span>
      </div>
    </details>
  );
}
export default function ForecastView({
  weather,
  tab,
  outings,
  onLog,
}: {
  weather: Forecast;
  tab: string;
  outings: Outing[];
  onLog: () => void;
}) {
  const [when, setWhen] = useState(
    localDateTime(new Date(Date.now() + 86400000).toISOString()).slice(0, 11) +
      "07:00",
  );
  const [duration, setDuration] = useState("90");
  const [route, setRoute] = useState("either");
  const [boat, setBoat] = useState("any");
  const [basis, setBasis] = useState("pooled");
  const [coach, setCoach] = useState("none");
  const [estimate, setEstimate] = useState<{
    source: string;
    reason: string | null;
    launch_probability: number | null;
    water_probabilities: number[] | null;
    forced_off_probability: number | null;
    outings: number;
  } | null>(null);
  const [estimateError, setEstimateError] = useState("");
  useEffect(() => {
    let active = true;
    setEstimate(null);
    setEstimateError("");
    if (tab !== "Plan" || !supabase) return;
    const timer = setTimeout(() => {
      let time;
      try {
        time = chicagoToISO(when);
      } catch {
        return;
      }
      void api<any>("assessment", { time, basis, route, boat, coach })
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
  }, [tab, when, basis, route, boat, coach]);
  const fresh = weatherFreshness(weather.fetched_at);
  const expired = fresh === "expired";
  const upcoming = weather.hours.filter(
    (h) => Date.parse(h.time) >= Date.now() - 1800000,
  );
  const current = weather.current ?? upcoming[0];
  const status = expired
    ? "unavailable"
    : windStatus(current?.wind, current?.direction);
  let start = NaN;
  try {
    start = Date.parse(chicagoToISO(when));
  } catch {}
  const selected = weather.hours.filter(
    (h) =>
      Date.parse(h.time) >= Math.floor(start / 3600000) * 3600000 &&
      Date.parse(h.time) < start + Number(duration) * 60000,
  );
  const days = [
    ...new Set(upcoming.map((h) => localDateTime(h.time).slice(0, 10))),
  ].slice(0, 5);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {tab === "Plan"
              ? "MAKE TIME FOR THE WATER"
              : "A LITTLE LOCAL KNOWLEDGE"}
          </p>
          <h1>
            {tab === "Now"
              ? "Before you push off."
              : tab === "Hourly"
                ? "Find your window."
                : "Plan your next row."}
          </h1>
          <p>
            {tab === "Now"
              ? "Wind, water, and a better feel for your next row."
              : "All times are local to Madison. Wind speeds are in mph."}
          </p>
        </div>
        <Wind size={40} className="heading-icon" />
      </div>
      {fresh !== "fresh" && (
        <div className="alert">
          {expired
            ? "This forecast has expired. Wind assessments are unavailable until a fresh forecast arrives."
            : "This forecast is more than two hours old. Conditions may have changed."}
        </div>
      )}
      {tab === "Now" && current && (
        <>
          <section className={"current-panel panel-" + status}>
            <div>
              <p className="eyebrow">
                JAMES MADISON PARK · {formatTime(current.time)}
              </p>
              <h2 className={"big-status " + status}>
                {STATUS_LABELS[status]}
              </h2>
              <p className="wind-reading">
                {current.wind?.toFixed(1) ?? "—"}
                <span> mph from {directionLabel(current.direction)}</span>
              </p>
              <div className="weather-facts">
                <span>
                  Gusts <b>{current.gust?.toFixed(0) ?? "—"} mph</b>
                </span>
                <span>
                  Air <b>{current.temperature?.toFixed(0) ?? "—"}°F</b>
                </span>
                <span>
                  Rain <b>{current.precipitation ?? "—"} in</b>
                </span>
              </div>
            </div>
            <div
              className="compass-mark"
              aria-label={"Wind from " + directionLabel(current.direction)}
            >
              <span>N</span>
              <ArrowDown
                size={76}
                strokeWidth={1.1}
                style={{ transform: `rotate(${current.direction ?? 0}deg)` }}
              />
              <small>{directionLabel(current.direction)} · WIND FROM</small>
            </div>
          </section>
          <div className="section-heading">
            <h2>The next few hours</h2>
            <span>Tap an hour for details</span>
          </div>
          <section className="hour-table">
            {upcoming.slice(0, 6).map((h) => (
              <HourRow key={h.time} hour={h} expired={expired} />
            ))}
          </section>
          <div className="log-callout">
            <div>
              <p className="eyebrow">JUST BACK?</p>
              <h2>How was the water?</h2>
              <p>Your ten-second report helps the next row.</p>
            </div>
            <button className="button" onClick={onLog}>
              Log a row <ArrowRight size={17} />
            </button>
          </div>
        </>
      )}
      {tab === "Hourly" && (
        <div className="day-sections">
          {days.slice(0, 3).map((day) => (
            <section key={day}>
              <div className="section-heading">
                <h2>{formatDate(day + "T12:00:00Z")}</h2>
              </div>
              <div className="hour-table">
                {upcoming
                  .filter((h) => localDateTime(h.time).startsWith(day))
                  .map((h) => (
                    <HourRow key={h.time} hour={h} expired={expired} />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {tab === "Plan" && (
        <>
          <section className="form-card">
            <div className="field-grid">
              <label>
                Start time
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
                </select>
              </label>
              <label>
                Route
                <select
                  value={route}
                  onChange={(e) => setRoute(e.target.value)}
                >
                  <option value="either">Either direction</option>
                  <option value="east">East</option>
                  <option value="west">West</option>
                </select>
              </label>
              <label>
                Boat
                <select value={boat} onChange={(e) => setBoat(e.target.value)}>
                  <option value="any">Any boat</option>
                  {BOAT_CLASSES.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
              <label>
                Use observations
                <select
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                >
                  <option value="pooled">Everyone’s data</option>
                  <option value="mine">Only my data</option>
                </select>
              </label>
              <label>
                Coach factor
                <select
                  value={coach}
                  onChange={(e) => setCoach(e.target.value)}
                >
                  <option value="none">No coach factor</option>
                  <option value="uncoached">Uncoached</option>
                  {[
                    "Charlie",
                    "Rose",
                    "Heather",
                    "Taylan",
                    "Alicia",
                    "Helena",
                    "Sam",
                    "Camille",
                    "Lexi",
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="help">
              The initial wind rule applies to all routes, boats, and coaches.{" "}
              {basis === "mine"
                ? "Personal estimates will use only your reports."
                : "Pooled estimates will count each outing once."}{" "}
              Personalized estimates will appear after there is enough validated
              data.
            </p>
          </section>
          {estimate && (
            <section className="form-card">
              <h2>
                {estimate.source === "heuristic"
                  ? "Using Hannah’s wind rule"
                  : "What logged outings suggest"}
              </h2>
              {estimate.reason ? (
                <p className="help">{estimate.reason}</p>
              ) : (
                <>
                  <p>
                    {estimate.launch_probability !== null
                      ? `${Math.round(estimate.launch_probability * 100)}% estimated rowing rate in similar conditions.`
                      : ""}
                  </p>
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
                    {basis === "mine" ? "Only your data" : "Pooled data"} · This
                    estimate is for the selected start time.
                  </p>
                </>
              )}
            </section>
          )}
          {estimateError && <p className="help">{estimateError}</p>}
          <div className="section-heading">
            <h2>Your selected window</h2>
            <span>
              <Clock size={14} />{" "}
              {Number(duration) === 1
                ? "Hourly forecast containing this time"
                : duration + " minutes"}
            </span>
          </div>
          <section className="hour-table">
            {selected.length ? (
              selected.map((h) => (
                <HourRow key={h.time} hour={h} expired={expired} />
              ))
            ) : (
              <p className="empty">
                Choose a time within the next seven days. A forecast is not
                available for this selection.
              </p>
            )}
          </section>
          <div className="section-heading">
            <h2>Five days at {when.slice(11)}</h2>
            <span>Same start time each day</span>
          </div>
          <section className="hour-table">
            {days.map((day) => {
              const h = upcoming.find(
                (h) =>
                  localDateTime(h.time).slice(0, 13) ===
                  day + "T" + when.slice(11, 13),
              );
              return h ? (
                <div key={day}>
                  <p className="day-label">{formatDate(h.time)}</p>
                  <HourRow hour={h} expired={expired} />
                </div>
              ) : null;
            })}
          </section>
          {!!outings.length && (
            <>
              <div className="section-heading">
                <h2>Scheduled outings</h2>
              </div>
              <div className="outing-grid">
                {outings
                  .filter((o) => Date.parse(o.starts_at) > Date.now())
                  .map((o) => (
                    <button
                      className="outing-card"
                      key={o.id}
                      onClick={() => {
                        setWhen(localDateTime(o.starts_at));
                        setDuration(
                          String(
                            Math.round(
                              (Date.parse(o.ends_at) -
                                Date.parse(o.starts_at)) /
                                60000,
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
      <aside className="method-note">
        <b>Starting with Hannah’s local wind rule.</b> These are wind
        assessments, not measured water conditions or probabilities of a safe
        row. Gusts, storms, cold water, visibility, and your crew still matter.{" "}
        <span>
          Updated {formatDate(weather.fetched_at)},{" "}
          {formatTime(weather.fetched_at)} ·{" "}
          <a href="https://open-meteo.com/">Open-Meteo</a> ·{" "}
          {weather.model_version}
        </span>
      </aside>
    </>
  );
}
