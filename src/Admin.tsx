import { useEffect, useState } from "react";
import { api } from "./client";
import {
  chicagoToISO,
  localDateTime,
  formatDate,
  formatTime,
} from "../shared/domain";
type AdminOuting = {
  id: string;
  title: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  actual_starts_at: string | null;
  actual_ends_at: string | null;
};
interface Health {
  database_bytes: number;
  weather_storage_bytes: number;
  failed_jobs: number;
  last_weather: string | null;
  models: {
    id: string;
    created_at: string;
    status: string;
    metrics: unknown;
    eligible: boolean;
    current_revision: boolean;
  }[];
}
export default function Admin() {
  const [health, setHealth] = useState<Health | null>(null);
  const [outings, setOutings] = useState<AdminOuting[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [outing, setOuting] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const refresh = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [h, o] = await Promise.all([
        api<Health>("health"),
        api<AdminOuting[]>("admin/outings"),
      ]);
      setHealth(h);
      setOutings(o);
      setHasMore(o.length === 200);
      setSource("");
      setTarget("");
      setOuting("");
      setStart("");
      setEnd("");
    } catch (e) {
      setHealth(null);
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const loadOlder = async () => {
    setBusy(true);
    setError("");
    try {
      const older = await api<AdminOuting[]>(
        `admin/outings?offset=${outings.length}`,
      );
      setOutings((previous) => [
        ...previous,
        ...older.filter((row) => !previous.some((p) => p.id === row.id)),
      ]);
      setHasMore(older.length === 200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || loading || !!loadError;
  const selected = outings.find((o) => o.id === outing);
  const activeModel = health?.models.find((m) => m.status === "active");
  const label = (o: AdminOuting) =>
    `${o.title} · ${formatDate(o.starts_at)} ${formatTime(o.starts_at)}`;
  return (
    <details className="admin-tools">
      <summary>Pilot administration</summary>
      {loading && <p role="status">Loading administration…</p>}
      {loadError && (
        <p className="alert" role="alert">
          Administration could not be loaded: {loadError}
        </p>
      )}
      <button
        className="text-button"
        disabled={busy || loading}
        onClick={() => void refresh()}
      >
        {loadError ? "Retry loading administration" : "Refresh administration"}
      </button>
      {health && !loading && (
        <>
          <p>
            Database {(health.database_bytes / 1e6).toFixed(1)} / 500 MB ·
            Weather {(health.weather_storage_bytes / 1e6).toFixed(1)} / 1000 MB
          </p>
          {[
            [health.database_bytes, 500e6, "Database"],
            [health.weather_storage_bytes, 1e9, "Weather storage"],
          ].map(([used, total, label]) =>
            Number(used) / Number(total) >= 0.7 ? (
              <p className="alert" key={String(label)}>
                {label} is at {Math.round((Number(used) / Number(total)) * 100)}
                % of the pilot allowance.{" "}
                {Number(used) / Number(total) >= 0.85
                  ? "Review capacity before inviting more users."
                  : "Check the provider dashboard."}
              </p>
            ) : null,
          )}
          <p className="help">
            Failed jobs: {health.failed_jobs}. Last weather:{" "}
            {health.last_weather
              ? formatDate(health.last_weather) +
                " " +
                formatTime(health.last_weather)
              : "Not collected yet"}
            .
          </p>
        </>
      )}
      {health && !loading && (
        <p role="status">
          Current forecasting method:{" "}
          {activeModel
            ? `Learned model from ${formatDate(activeModel.created_at)} (Hannah’s rule remains the fallback).`
            : "Hannah’s rule."}
        </p>
      )}
      <p className="help">
        Rows are listed newest first. Load older rows to find earlier events.
      </p>
      {hasMore && (
        <button
          className="button subtle"
          disabled={disabled}
          onClick={() => void loadOlder()}
        >
          Load older rows
        </button>
      )}
      {!loading && !loadError && outings.length === 0 && (
        <p className="help">No rows yet.</p>
      )}
      <h3>Reconcile duplicate rows</h3>
      <p className="help">
        Use only when these records describe the same event. Keep the official
        practice when one exists; two independent rows can also be merged.
        Conflicting reports by the same person block the merge.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const duplicate = outings.find((o) => o.id === source);
          const destination = outings.find((o) => o.id === target);
          if (!duplicate || !destination || source === target) return;
          if (
            !confirm(
              `Merge “${label(duplicate)}” into “${label(destination)}”? The duplicate row will be removed and its reports moved to the kept row.`,
            )
          )
            return;
          void run(async () => {
            await api("outings/reconcile", {
              source,
              target,
            });
            setMessage("Rows reconciled.");
          });
        }}
      >
        <label>
          Duplicate to merge
          <select
            name="source"
            required
            disabled={disabled}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              if (target === e.target.value) setTarget("");
            }}
          >
            <option value="">Choose an independent row</option>
            {outings
              .filter((o) => o.kind === "independent")
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {label(o)}
                </option>
              ))}
          </select>
        </label>
        <label>
          Keep this row
          <select
            name="target"
            required
            disabled={disabled}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Choose the shared event</option>
            {outings
              .filter((o) => o.id !== source)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {label(o)}
                </option>
              ))}
          </select>
        </label>
        <button
          className="button subtle"
          disabled={disabled || !source || !target}
        >
          Merge duplicate
        </button>
      </form>
      <h3>Correct a shared actual interval</h3>
      <p className="help">
        Scheduled times and each person’s original report remain preserved. This
        sets the agreed interval for weather enrichment and retires any active
        learned model. Forecasts return to Hannah’s rule until a model is
        approved again.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!selected) return;
          setError("");
          let actualStart: string;
          let actualEnd: string;
          try {
            actualStart = chicagoToISO(start);
            actualEnd = chicagoToISO(end);
            if (actualEnd <= actualStart)
              throw new Error("End must be after start.");
          } catch (e) {
            setError((e as Error).message);
            return;
          }
          if (
            !confirm(
              `Set “${label(selected)}” to ${formatDate(actualStart)} ${formatTime(actualStart)} – ${formatDate(actualEnd)} ${formatTime(actualEnd)} (Madison)? Any active learned model will be retired; forecasts will use Hannah’s rule.`,
            )
          )
            return;
          void run(async () => {
            await api("outings/interval", {
              id: outing,
              start: actualStart,
              end: actualEnd,
            });
            setMessage(
              "Actual interval saved. Weather enrichment is queued. Forecasts now use Hannah’s rule.",
            );
          });
        }}
      >
        <label>
          Row
          <select
            name="outing"
            required
            disabled={disabled}
            value={outing}
            onChange={(e) => {
              setOuting(e.target.value);
              const row = outings.find((o) => o.id === e.target.value);
              setStart(
                row ? localDateTime(row.actual_starts_at ?? row.starts_at) : "",
              );
              setEnd(
                row ? localDateTime(row.actual_ends_at ?? row.ends_at) : "",
              );
            }}
          >
            <option value="">Choose a row</option>
            {outings.map((o) => (
              <option key={o.id} value={o.id}>
                {label(o)}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <p className="help">
            Scheduled: {formatDate(selected.starts_at)}{" "}
            {formatTime(selected.starts_at)} – {formatDate(selected.ends_at)}{" "}
            {formatTime(selected.ends_at)}.
            {selected.actual_starts_at && selected.actual_ends_at
              ? ` Current actual: ${formatDate(selected.actual_starts_at)} ${formatTime(selected.actual_starts_at)} – ${formatDate(selected.actual_ends_at)} ${formatTime(selected.actual_ends_at)}.`
              : " No agreed actual interval yet; the fields start with the scheduled times."}
          </p>
        )}
        <label>
          Actual start · Madison
          <input
            name="start"
            type="datetime-local"
            required
            disabled={disabled || !outing}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Actual end
          <input
            name="end"
            type="datetime-local"
            required
            disabled={disabled || !outing}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button className="button subtle" disabled={disabled || !outing}>
          Save interval
        </button>
      </form>
      <h3>Model review</h3>
      <p className="help">
        Publish only after reviewing held-out performance and calibration. The
        server requires eligibility and the current data revision.
      </p>
      {health &&
        !loading &&
        (health.models.length ? (
          health.models.map((m) => (
            <details key={m.id}>
              <summary>
                {formatDate(m.created_at)} · {m.status}
              </summary>
              <p className="help">
                {m.status === "active"
                  ? "Currently active."
                  : !m.eligible
                    ? "Not eligible for publication."
                    : !m.current_revision
                      ? "Training data has changed. Train a new model before publishing."
                      : "Eligible for review and publication."}
              </p>
              <pre className="metrics">
                {JSON.stringify(m.metrics, null, 2)}
              </pre>
              <button
                className="button subtle"
                disabled={
                  disabled ||
                  m.status === "active" ||
                  !m.eligible ||
                  !m.current_revision
                }
                onClick={() => {
                  if (confirm("Approve and publish this model for the pilot?"))
                    void run(async () => {
                      await api("models/publish", { id: m.id });
                      setMessage("Model published.");
                    });
                }}
              >
                Approve model
              </button>
            </details>
          ))
        ) : (
          <p className="help">
            No trained models yet. Forecasts use Hannah’s rule.
          </p>
        ))}
      <button
        className="text-button"
        disabled={disabled || !activeModel}
        onClick={() => {
          if (
            !confirm(
              "Retire the active learned model and return forecasts to Hannah’s rule?",
            )
          )
            return;
          void run(async () => {
            await api("models/rollback", {});
            setMessage("Forecasts now use Hannah’s rule.");
          });
        }}
      >
        Return to Hannah’s rule
      </button>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
