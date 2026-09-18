import { useEffect, useState } from "react";
import { api } from "./client";
import { chicagoToISO, formatDate, formatTime } from "../shared/domain";
type AdminOuting = {
  id: string;
  title: string;
  kind: string;
  starts_at: string;
  ends_at: string;
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
  }[];
}
export default function Admin() {
  const [health, setHealth] = useState<Health | null>(null);
  const [outings, setOutings] = useState<AdminOuting[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const [h, o] = await Promise.all([
      api<Health>("health"),
      api<AdminOuting[]>("admin/outings"),
    ]);
    setHealth(h);
    setOutings(o);
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
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
  const label = (o: AdminOuting) =>
    `${o.title} · ${formatDate(o.starts_at)} ${formatTime(o.starts_at)}`;
  return (
    <details className="admin-tools">
      <summary>Pilot administration</summary>
      {health && (
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
      <h3>Reconcile duplicate rows</h3>
      <p className="help">
        Use only when these records describe the same event. An official
        practice must be the destination. Conflicting reports by the same person
        block the merge.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (!confirm("Merge these two records into one shared row?")) return;
          void run(async () => {
            await api("outings/reconcile", {
              source: f.get("source"),
              target: f.get("target"),
            });
            setMessage("Rows reconciled.");
          });
        }}
      >
        <label>
          Duplicate to merge
          <select name="source" required>
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
          <select name="target" required>
            <option value="">Choose the shared event</option>
            {outings.map((o) => (
              <option key={o.id} value={o.id}>
                {label(o)}
              </option>
            ))}
          </select>
        </label>
        <button className="button subtle" disabled={busy}>
          Merge duplicate
        </button>
      </form>
      <h3>Correct a shared actual interval</h3>
      <p className="help">
        Scheduled times and each person’s original report remain preserved. This
        sets the agreed interval for weather enrichment.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void run(async () => {
            await api("outings/interval", {
              id: f.get("outing"),
              start: chicagoToISO(String(f.get("start"))),
              end: chicagoToISO(String(f.get("end"))),
            });
            setMessage("Actual interval saved. Weather enrichment is queued.");
          });
        }}
      >
        <label>
          Row
          <select name="outing" required>
            <option value="">Choose a row</option>
            {outings.map((o) => (
              <option key={o.id} value={o.id}>
                {label(o)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Actual start · Madison
          <input name="start" type="datetime-local" required />
        </label>
        <label>
          Actual end
          <input name="end" type="datetime-local" required />
        </label>
        <button className="button subtle" disabled={busy}>
          Save interval
        </button>
      </form>
      <h3>Model review</h3>
      <p className="help">
        Publish only after reviewing held-out performance and calibration. The
        server requires eligibility and the current data revision.
      </p>
      {health?.models.length ? (
        health.models.map((m) => (
          <details key={m.id}>
            <summary>
              {formatDate(m.created_at)} · {m.status}
            </summary>
            <pre className="metrics">{JSON.stringify(m.metrics, null, 2)}</pre>
            <button
              className="button subtle"
              disabled={busy || m.status === "active"}
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
      )}
      <button
        className="text-button"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await api("models/rollback", {});
            setMessage("Forecasts now use Hannah’s rule.");
          })
        }
      >
        Return to Hannah’s rule
      </button>
      {message && <p className="notice">{message}</p>}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
