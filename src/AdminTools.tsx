import { useState } from "react";
import { api } from "./client";
import { chicagoToISO, localDateTime } from "../shared/domain";
import {
  adminStamp,
  useAdminAction,
  useAdminData,
  useAdminOutings,
  type AdminHealth,
  type AdminOuting,
} from "./adminData";

export function AdminActionStatus({
  error,
  message,
}: {
  error: string;
  message: string;
}) {
  return (
    <>
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
    </>
  );
}
function OutingSummary({
  outing,
  title,
}: {
  outing: AdminOuting;
  title: string;
}) {
  return (
    <section className="admin-panel">
      <h2>{title}</h2>
      <h3>{outing.title}</h3>
      <dl className="admin-health">
        <dt>Type</dt>
        <dd>
          {outing.kind === "official" ? "Official practice" : "Independent row"}
        </dd>
        <dt>Scheduled start</dt>
        <dd>{adminStamp(outing.starts_at)}</dd>
        <dt>Scheduled end</dt>
        <dd>{adminStamp(outing.ends_at)}</dd>
        <dt>Actual start</dt>
        <dd>
          {outing.actual_starts_at
            ? adminStamp(outing.actual_starts_at)
            : "Not set"}
        </dd>
        <dt>Actual end</dt>
        <dd>
          {outing.actual_ends_at
            ? adminStamp(outing.actual_ends_at)
            : "Not set"}
        </dd>
      </dl>
    </section>
  );
}
const label = (o: AdminOuting) => `${o.title} · ${adminStamp(o.starts_at)}`;
function OutingLoadStatus({
  busy,
  error,
  refresh,
  hasMore,
  loadOlder,
}: {
  busy: boolean;
  error: string;
  refresh: () => Promise<void>;
  hasMore: boolean;
  loadOlder: () => Promise<void>;
}) {
  return (
    <>
      {busy && <p role="status">Loading rows…</p>}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <p className="help">
        Rows are listed newest first. Load older rows to find earlier events.
      </p>
      <div className="header-actions">
        <button
          className="button subtle"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {error ? "Retry loading rows" : "Refresh rows"}
        </button>
        {hasMore && (
          <button
            className="button subtle"
            disabled={busy}
            onClick={() => void loadOlder()}
          >
            Load older rows
          </button>
        )}
      </div>
    </>
  );
}
export function AdminReconcile() {
  const rows = useAdminOutings();
  const action = useAdminAction();
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const sourceRow = rows.data?.find((o) => o.id === source);
  const targetRow = rows.data?.find((o) => o.id === target);
  return (
    <>
      <p className="help">
        Use only when these records describe the same event. An official
        practice must be the destination when present. Conflicting reports by
        the same person block the merge.
      </p>
      <OutingLoadStatus {...rows} />
      {rows.data && !rows.data.length && <p>No rows are available.</p>}
      <form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          setReviewing(true);
        }}
      >
        <fieldset disabled={rows.busy || action.busy || !!rows.error}>
          <label>
            Duplicate to merge
            <select
              name="source"
              required
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                if (target === e.target.value) setTarget("");
                setReviewing(false);
              }}
            >
              <option value="">Choose an independent row</option>
              {rows.data
                ?.filter((o) => o.kind === "independent")
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
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setReviewing(false);
              }}
            >
              <option value="">Choose the shared event</option>
              {rows.data
                ?.filter((o) => o.id !== source)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {label(o)}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="button subtle"
            disabled={!sourceRow || !targetRow || source === target}
          >
            Review merge
          </button>
        </fieldset>
      </form>
      {sourceRow && targetRow && source !== target && (
        <div className="admin-comparison">
          <OutingSummary outing={sourceRow} title="Duplicate to merge" />
          <OutingSummary outing={targetRow} title="Row to keep" />
        </div>
      )}
      {reviewing && sourceRow && targetRow && source !== target && (
        <section className="admin-panel admin-merge-review">
          <h2>Confirm this merge</h2>
          <p>
            Merge “{sourceRow.title}” into “{targetRow.title}”. The destination
            row will remain and the duplicate will be removed. This cannot be
            undone here.
          </p>
          <div className="header-actions">
            <button
              className="button"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api("outings/reconcile", { source, target });
                  setSource("");
                  setTarget("");
                  setReviewing(false);
                  action.setMessage("Rows reconciled.");
                  await rows.refresh();
                })
              }
            >
              {action.busy ? "Merging…" : "Confirm merge"}
            </button>
            <button
              className="button subtle"
              disabled={action.busy}
              onClick={() => setReviewing(false)}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      <AdminActionStatus {...action} />
    </>
  );
}
export function AdminIntervals() {
  const rows = useAdminOutings();
  const action = useAdminAction();
  const [selected, setSelected] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const row = rows.data?.find((o) => o.id === selected);
  return (
    <>
      <p className="help">
        Scheduled times and each person’s original report remain preserved. This
        sets the agreed interval for weather enrichment and retires any active
        learned model. Forecasts return to Hannah’s rule until a model is
        approved again. All times use Madison time.
      </p>
      <OutingLoadStatus {...rows} />
      {rows.data && !rows.data.length && <p>No rows are available.</p>}
      <form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!row) return;
          void action.run(async () => {
            const actualStart = chicagoToISO(start),
              actualEnd = chicagoToISO(end);
            if (actualEnd <= actualStart)
              throw new Error("Actual end must be after actual start.");
            if (
              !confirm(
                `Set “${label(row)}” to ${adminStamp(actualStart)} – ${adminStamp(actualEnd)} (Madison)? Any active learned model will be retired; forecasts will use Hannah’s rule.`,
              )
            )
              return;
            await api("outings/interval", {
              id: selected,
              start: actualStart,
              end: actualEnd,
            });
            action.setMessage(
              "Actual interval saved. Weather enrichment is queued. Forecasts now use Hannah’s rule.",
            );
            await rows.refresh();
          });
        }}
      >
        <fieldset disabled={rows.busy || action.busy || !!rows.error}>
          <label>
            Row
            <select
              name="outing"
              required
              value={selected}
              onChange={(e) => {
                const outing = rows.data?.find((o) => o.id === e.target.value);
                setSelected(e.target.value);
                setStart(
                  outing
                    ? localDateTime(outing.actual_starts_at || outing.starts_at)
                    : "",
                );
                setEnd(
                  outing
                    ? localDateTime(outing.actual_ends_at || outing.ends_at)
                    : "",
                );
              }}
            >
              <option value="">Choose a row</option>
              {rows.data?.map((o) => (
                <option key={o.id} value={o.id}>
                  {label(o)}
                </option>
              ))}
            </select>
          </label>
          {row && <OutingSummary outing={row} title="Current times" />}
          <div className="admin-time-fields">
            <label>
              Actual start · Madison
              <input
                name="start"
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Actual end · Madison
              <input
                name="end"
                type="datetime-local"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <button className="button" disabled={!row}>
            {action.busy ? "Saving…" : "Save interval"}
          </button>
        </fieldset>
      </form>
      <AdminActionStatus {...action} />
    </>
  );
}
export function AdminModels() {
  const health = useAdminData<AdminHealth>("health");
  const action = useAdminAction();
  const activeModel = health.data?.models.find((m) => m.status === "active");
  return (
    <>
      <div className="admin-section-heading">
        <p className="help">
          Publish only after reviewing held-out performance and calibration. The
          server requires eligibility and the current data revision.
        </p>
        <button
          className="button subtle"
          disabled={health.busy || action.busy}
          onClick={() => void health.refresh()}
        >
          {health.busy ? "Loading…" : "Refresh"}
        </button>
      </div>
      {health.error && (
        <p className="alert" role="alert">
          {health.error}
        </p>
      )}
      {health.data && (
        <p role="status">
          Current forecasting method:{" "}
          {activeModel
            ? `Learned model from ${adminStamp(activeModel.created_at)} (Hannah’s rule remains the fallback).`
            : "Hannah’s rule."}
        </p>
      )}
      {health.data &&
        (health.data.models.length ? (
          health.data.models.map((m) => (
            <section className="admin-panel" key={m.id}>
              <h2>
                {adminStamp(m.created_at)} · {m.status}
              </h2>
              <p className="help">
                {m.status === "active"
                  ? "Currently active."
                  : !m.eligible
                    ? "Not eligible for publication."
                    : !m.current_revision
                      ? "Training data has changed. Train a new model before publishing."
                      : "Eligible for review and publication."}
              </p>
              <details>
                <summary>Performance metrics</summary>
                <pre className="metrics">
                  {JSON.stringify(m.metrics, null, 2)}
                </pre>
              </details>
              <button
                className="button subtle"
                disabled={
                  action.busy ||
                  health.busy ||
                  !!health.error ||
                  m.status === "active" ||
                  !m.eligible ||
                  !m.current_revision
                }
                onClick={() => {
                  if (confirm("Approve and publish this model for the pilot?"))
                    void action.run(async () => {
                      await api("models/publish", { id: m.id });
                      action.setMessage("Model published.");
                      await health.refresh();
                    });
                }}
              >
                Approve model
              </button>
            </section>
          ))
        ) : (
          <p>No trained models yet. Forecasts use Hannah’s rule.</p>
        ))}
      {health.data && (
        <section className="admin-panel">
          <h2>Use Hannah’s rule</h2>
          <p>Return pilot forecasts to the original wind rule.</p>
          <button
            className="button subtle"
            disabled={
              action.busy || health.busy || !!health.error || !activeModel
            }
            onClick={() => {
              if (
                confirm(
                  "Retire the active learned model and return forecasts to Hannah’s rule?",
                )
              )
                void action.run(async () => {
                  await api("models/rollback", {});
                  action.setMessage("Forecasts now use Hannah’s rule.");
                  await health.refresh();
                });
            }}
          >
            Return to Hannah’s rule
          </button>
        </section>
      )}
      <AdminActionStatus {...action} />
    </>
  );
}
