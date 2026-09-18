import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Save } from "lucide-react";
import {
  BOAT_CLASSES,
  RATINGS,
  ROUTES,
  boatExtremes,
  chicagoToISO,
  localDateTime,
  formatDate,
  formatTime,
  outingSchema,
  reportSchema,
  type Coach,
  type Outing,
  type OutingInput,
  type Report,
  type ReportInput,
} from "../shared/domain";
import { canLog } from "../shared/presentation";
import { useClock } from "./useClock";
import { clearDraft, draft, flush, stage } from "./outbox";
export default function Logger({
  user,
  outings,
  coaches,
  editing,
  initialOuting,
  onSaved,
}: {
  user: string;
  outings: Outing[];
  coaches: Coach[];
  editing?: { outing: Outing; report: Report };
  initialOuting?: string;
  onSaved: (message: string) => void;
}) {
  const now = useClock();
  const initial = outings.find((o) => o.id === initialOuting);
  const [selected, setSelected] = useState(
    editing?.outing.id || initialOuting || "new",
  );
  const [outcome, setOutcome] = useState<ReportInput["outcome"]>(
    editing?.report.outcome || "rowed",
  );
  const [rating, setRating] = useState<number | null>(
    editing?.report.rating ?? null,
  );
  const [route, setRoute] = useState<ReportInput["route"]>(
    editing?.report.route || "unknown",
  );
  const [start, setStart] = useState(
    localDateTime(
      editing?.report.actual_start ||
        editing?.outing.starts_at ||
        initial?.starts_at ||
        new Date(Date.now() - 5400000).toISOString(),
    ),
  );
  const [end, setEnd] = useState(
    localDateTime(
      editing?.report.actual_end ||
        editing?.outing.ends_at ||
        (initial
          ? new Date(
              Math.min(Date.parse(initial.ends_at), Date.now()),
            ).toISOString()
          : undefined) ||
        new Date().toISOString(),
    ),
  );
  const [title, setTitle] = useState(
    editing?.outing.title || "Independent row",
  );
  const [boat, setBoat] = useState<ReportInput["boat_class"]>(
    editing?.report.boat_class ??
      (initial?.planned_boat as ReportInput["boat_class"]) ??
      null,
  );
  const [reason, setReason] = useState<ReportInput["reason"]>(
    editing?.report.reason ?? "unknown",
  );
  const [coachState, setCoachState] = useState<ReportInput["coach_state"]>(
    editing?.report.coach_state ||
      (initial?.kind === "official" ? "unknown" : "uncoached"),
  );
  const [coachIds, setCoachIds] = useState<string[]>(
    editing?.report.coach_ids || [],
  );
  const [coachCount, setCoachCount] = useState<number | null>(
    editing?.report.coach_count ?? 0,
  );
  const [launched, setLaunched] = useState<ReportInput["launched_boats"]>(
    editing?.report.launched_boats || [],
  );
  const [smallest, setSmallest] = useState<number | null>(
    editing?.report.smallest_boat ?? null,
  );
  const [largest, setLargest] = useState<number | null>(
    editing?.report.largest_boat ?? null,
  );
  const [notes, setNotes] = useState(editing?.report.notes || "");
  const [segments, setSegments] = useState<ReportInput["segments"]>(
    editing?.report.segments || [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (editing || initialOuting) {
      setReady(true);
      return;
    }
    draft(user)
      .then((v) => {
        if (v) {
          setSelected(
            outings.some((o) => o.id === v.selected && canLog(o, Date.now()))
              ? v.selected
              : "new",
          );
          setOutcome(v.outcome);
          setRating(v.rating);
          setRoute(v.route);
          setStart(v.start);
          setEnd(v.end);
          setTitle(v.title);
          setBoat(v.boat);
          setReason(v.reason);
          setCoachState(v.coachState);
          setCoachIds(v.coachIds);
          setCoachCount(v.coachCount);
          setLaunched(v.launched);
          setSmallest(v.smallest);
          setLargest(v.largest);
          setNotes(v.notes);
          setSegments(v.segments);
          setRestored(true);
        }
        setReady(true);
      })
      .catch(() => setReady(true));
  }, [user, editing, initialOuting]);
  const latestDraft = useRef<{ user: string; value: unknown } | null>(null);
  const completedDraft = useRef(false);
  useEffect(
    () => () => {
      const latest = latestDraft.current;
      if (latest && !completedDraft.current)
        void draft(latest.user, latest.value).catch(() => {});
    },
    [],
  );
  useEffect(() => {
    if (!ready || editing) return;
    const value = {
      selected,
      outcome,
      rating,
      route,
      start,
      end,
      title,
      boat,
      reason,
      coachState,
      coachIds,
      coachCount,
      launched,
      smallest,
      largest,
      notes,
      segments,
    };
    latestDraft.current = { user, value };
    const timer = setTimeout(() => {
      if (!completedDraft.current) void draft(user, value).catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [
    ready,
    user,
    editing,
    selected,
    outcome,
    rating,
    route,
    start,
    end,
    title,
    boat,
    reason,
    coachState,
    coachIds,
    coachCount,
    launched,
    smallest,
    largest,
    notes,
    segments,
  ]);
  const chosen = outings.find((o) => o.id === selected);
  const toggleCoach = (id: string) => {
    const ids = coachIds.includes(id)
      ? coachIds.filter((c) => c !== id)
      : [...coachIds, id];
    setCoachIds(ids);
    setCoachCount(ids.length || null);
  };
  function choose(id: string) {
    setSelected(id);
    const o = outings.find((o) => o.id === id);
    if (o) {
      setStart(localDateTime(o.starts_at));
      setEnd(
        localDateTime(
          new Date(Math.min(Date.parse(o.ends_at), Date.now())).toISOString(),
        ),
      );
      setCoachState(o.kind === "official" ? "unknown" : "uncoached");
      setCoachIds([]);
      setCoachCount(o.kind === "official" ? null : 0);
      setBoat(o.planned_boat as ReportInput["boat_class"]);
    } else {
      setCoachState("uncoached");
      setCoachCount(0);
      setCoachIds([]);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const outing: OutingInput =
        chosen ??
        outingSchema.parse({
          id: crypto.randomUUID(),
          kind: "independent",
          title,
          starts_at: chicagoToISO(start),
          ends_at: chicagoToISO(end),
          planned_boat: boat,
          reminder: false,
        });
      if (Date.parse(chicagoToISO(start)) > Date.now())
        throw new Error(
          "This row has not started yet. Use “Add independent row” to schedule it.",
        );
      const extremes = launched.length
        ? boatExtremes(launched)
        : { smallest, largest };
      const report = reportSchema.parse({
        submission_id: crypto.randomUUID(),
        expected_version: editing?.report.version || 0,
        // Preserve legacy metadata when editing; new reports use the schema default.
        scope: editing?.report.scope,
        outcome,
        reason: outcome === "stayed_ashore" ? reason : null,
        rating: outcome === "rowed" ? rating : null,
        route: outcome === "rowed" ? route : "unknown",
        boat_class: outcome === "rowed" ? boat : null,
        launched_boats: outcome === "rowed" ? launched : [],
        coach_state: coachState,
        coach_ids: coachIds,
        coach_count: coachState === "uncoached" ? 0 : coachCount,
        smallest_boat: outcome === "rowed" ? extremes.smallest : null,
        largest_boat: outcome === "rowed" ? extremes.largest : null,
        actual_start: chicagoToISO(start),
        actual_end: chicagoToISO(end),
        notes,
        segments: outcome === "rowed" && route === "both" ? segments : [],
      });
      await stage(user, outing, report);
      completedDraft.current = true;
      await clearDraft(user);
      const result = navigator.onLine ? await flush(user) : { remaining: [1] };
      onSaved(
        result.remaining.length
          ? "Saved on this device. Waiting to upload; you can retry from My rows."
          : "Report saved.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save report.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A SMALL EFFORT. A BETTER FORECAST.</p>
          <h1>{editing ? "Edit your report." : "How was the water?"}</h1>
        </div>
      </div>
      {restored && (
        <p className="notice">
          Your unfinished draft was restored from this device.
        </p>
      )}
      <form onSubmit={save} className="logger">
        <section className="form-card">
          <label>
            Which row?
            <select
              value={selected}
              disabled={!!editing}
              onChange={(e) => choose(e.target.value)}
            >
              <option value="new">＋ Independent / unofficial row</option>
              {outings
                .filter(
                  (o) =>
                    (canLog(o, now) || editing?.outing.id === o.id) &&
                    (!o.reports?.length || editing?.outing.id === o.id),
                )
                .sort(
                  (a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at),
                )
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title} · {formatDate(o.starts_at)}{" "}
                    {formatTime(o.starts_at)}
                  </option>
                ))}
            </select>
          </label>
          <details className="time-details" open={!!editing}>
            <summary>
              <span>
                {start.slice(5, 10)} · {start.slice(11)}–{end.slice(11)}
              </span>
              <span>Edit date & time</span>
            </summary>
            {selected === "new" && (
              <label>
                Outing name
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  required
                />
              </label>
            )}
            <div className="field-grid">
              <label>
                {chosen ? "Actual start" : "Start"} · Madison time
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  required
                />
              </label>
              <label>
                {chosen ? "Actual end" : "End"}
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  required
                />
              </label>
            </div>
            {chosen?.kind === "official" && (
              <p className="help">
                Scheduled {formatTime(chosen.starts_at)}–
                {formatTime(chosen.ends_at)}.{" "}
                {chosen.planned_coaches?.length
                  ? `Planned coaches: ${chosen.planned_coaches.join(", ")}. `
                  : ""}
                BHC lineups are plans; confirm what actually happened below.
              </p>
            )}
          </details>
          <fieldset>
            <legend>Did you get on the water?</legend>
            <div className="choices">
              {(
                [
                  ["rowed", "Rowed"],
                  ["stayed_ashore", "Stayed ashore"],
                  ["did_not_attend", "Didn’t attend"],
                ] as const
              ).map(([v, label]) => (
                <button
                  type="button"
                  key={v}
                  aria-pressed={outcome === v}
                  className={outcome === v ? "active" : ""}
                  onClick={() => setOutcome(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          {outcome === "stayed_ashore" && (
            <label>
              What kept you ashore?
              <select
                value={reason ?? "unknown"}
                onChange={(e) =>
                  setReason(e.target.value as ReportInput["reason"])
                }
              >
                <option value="unknown">Not sure</option>
                <option value="wind_waves">Wind / waves</option>
                <option value="other_weather">Other weather</option>
                <option value="non_weather">Something else</option>
              </select>
            </label>
          )}
          {outcome === "rowed" && (
            <>
              <fieldset>
                <legend>How was the water?</legend>
                <div className="rating-choices">
                  {RATINGS.map((label, i) => (
                    <button
                      type="button"
                      key={label}
                      aria-pressed={rating === i + 1}
                      className={rating === i + 1 ? "active" : ""}
                      onClick={() => setRating(i + 1)}
                    >
                      <b>{i + 1}</b>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Which direction?</legend>
                <div className="choices">
                  {ROUTES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={route === v}
                      className={route === v ? "active" : ""}
                      onClick={() => setRoute(v)}
                    >
                      {v === "unknown"
                        ? "Not sure"
                        : v[0].toUpperCase() + v.slice(1)}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}
        </section>
        <details className="form-card" open={!!editing}>
          <summary>
            Boats, coaches & more <ChevronDown size={18} />
          </summary>
          <p className="help">
            Optional details help explain why the same wind can mean different
            things to different crews.
          </p>
          {outcome === "rowed" && (
            <>
              <label>
                Your boat
                <select
                  value={boat ?? ""}
                  onChange={(e) =>
                    setBoat(
                      (e.target.value as ReportInput["boat_class"]) || null,
                    )
                  }
                >
                  <option value="">Unknown / not recorded</option>
                  {BOAT_CLASSES.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>Boat classes that actually went out</legend>
                <div className="choices wrap">
                  {BOAT_CLASSES.map((b) => (
                    <button
                      type="button"
                      key={b}
                      aria-pressed={launched.includes(b)}
                      className={launched.includes(b) ? "active" : ""}
                      onClick={() =>
                        setLaunched(
                          launched.includes(b)
                            ? launched.filter((x) => x !== b)
                            : [...launched, b],
                        )
                      }
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </fieldset>
              {!launched.length && (
                <div className="field-grid">
                  <label>
                    Smallest boat
                    <select
                      value={smallest ?? ""}
                      onChange={(e) =>
                        setSmallest(Number(e.target.value) || null)
                      }
                    >
                      <option value="">Unknown</option>
                      {[1, 2, 4, 8].map((n) => (
                        <option key={n} value={n}>
                          {n} rower{n > 1 ? "s" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Biggest boat
                    <select
                      value={largest ?? ""}
                      onChange={(e) =>
                        setLargest(Number(e.target.value) || null)
                      }
                    >
                      <option value="">Unknown</option>
                      {[1, 2, 4, 8].map((n) => (
                        <option key={n} value={n}>
                          {n} rower{n > 1 ? "s" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </>
          )}
          <label>
            Coaching
            <select
              value={coachState}
              onChange={(e) => {
                setCoachState(e.target.value as ReportInput["coach_state"]);
                setCoachIds([]);
                setCoachCount(e.target.value === "uncoached" ? 0 : null);
              }}
            >
              <option value="uncoached">N/A — uncoached</option>
              <option value="known">Coached</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          {coachState === "known" && (
            <>
              <fieldset>
                <legend>Which coaches?</legend>
                <div className="choices wrap">
                  {coaches.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      aria-pressed={coachIds.includes(c.id)}
                      className={coachIds.includes(c.id) ? "active" : ""}
                      onClick={() => toggleCoach(c.id)}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label>
                Coach count{coachIds.length ? " (from your selection)" : ""}
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={coachCount ?? ""}
                  disabled={!!coachIds.length}
                  onChange={(e) =>
                    setCoachCount(
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </label>
            </>
          )}
          {route === "both" && outcome === "rowed" && (
            <div className="field-grid">
              {(["east", "west"] as const).map((r) => (
                <label key={r}>
                  {r === "east" ? "East" : "West"} water (optional)
                  <select
                    value={segments.find((s) => s.route === r)?.rating ?? ""}
                    onChange={(e) =>
                      setSegments([
                        ...segments.filter((s) => s.route !== r),
                        ...(e.target.value
                          ? [{ route: r, rating: Number(e.target.value) }]
                          : []),
                      ])
                    }
                  >
                    <option value="">Not rated separately</option>
                    {RATINGS.map((s, i) => (
                      <option key={s} value={i + 1}>
                        {i + 1} · {s}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          <label>
            Anything else?
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Different water on the return, a shortened row…"
            />
          </label>
        </details>
        {error && (
          <div role="alert" className="alert">
            {error}
          </div>
        )}
        <div className="save-bar">
          <span>
            <Save size={14} /> Draft stays on this device
          </span>
          <button className="button" disabled={busy || !ready} type="submit">
            <Check size={18} />
            {busy ? "Saving…" : editing ? "Save changes" : "Save report"}
          </button>
        </div>
      </form>
    </>
  );
}
