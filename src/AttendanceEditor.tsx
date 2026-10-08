import { useEffect, useState } from "react";
import { type AttendanceChoice, type AttendanceState } from "../shared/bhc";
import {
  BHC_LOGIN_URL,
  COACHES_EMAIL,
  formatDate,
  formatTime,
  type Outing,
} from "../shared/domain";
import { Modal } from "./Account";
import { api, ApiError } from "./client";
import { AttendanceRoster } from "./AttendanceRoster";
type Result = {
  state: AttendanceState | null;
  outcome: string;
  message?: string;
};
export default function AttendanceEditor({
  outing,
  user,
  now,
  onClose,
  onRefresh,
  onReconnect,
}: {
  outing: Outing;
  user: string;
  now: number;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onReconnect: () => void;
}) {
  const [state, setState] = useState<AttendanceState | null>(null);
  const [choice, setChoice] = useState<AttendanceChoice | "">("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const stagingPractice = import.meta.env.VITE_STAGING === "true" && ["e746607c-f17f-4f59-833e-267f21fb7802", "c68221b7-f064-4b4d-aec5-4b616329925e"].includes(outing.id);
  async function send(change = false) {
    if (!navigator.onLine) {
      setError(
        "Connect to the internet to check or change BHC attendance. Changes are not saved offline.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<Result>(
        "bhc/attendance",
        {
          outing_id: outing.id,
          ...(change && state && choice
            ? {
                change: {
                  attendance: choice,
                  expected: state.attendance,
                  request_id: crypto.randomUUID(),
                },
              }
            : {}),
        },
        user,
      );
      setState(result.state);
      setChoice("");
      setUncertain(result.outcome === "unconfirmed");
      if (result.message) setError(result.message);
      else if (result.outcome === "confirmed")
        setMessage(stagingPractice ? "Attendance updated for this fictional staging practice." : "Attendance updated in BHC.");
      else if (!change) setMessage(stagingPractice ? "Test attendance checked." : "Status checked with BHC.");
      await onRefresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "bhc_reconnect_required")
        setNeedsReconnect(true);
      void onRefresh();
      setUncertain(change || uncertain);
      setError(
        change
          ? "The request could not be confirmed. Check BHC status before trying again."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void send();
  }, []);
  const closed = !!state?.deadline && now >= Date.parse(state.deadline);
  const allowed = state?.allowed && !closed && !uncertain;
  return (
    <Modal
      title="Practice attendance"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        <strong>{outing.title}</strong>
        <br />
        {formatDate(outing.starts_at)} · {formatTime(outing.starts_at)}
      </p>
      {stagingPractice && <p className="muted">Fictional staging practice. Attendance changes affect only this test account.</p>}
      {state && (
        <>
          <p>
            {stagingPractice ? "Test attendance:" : "In BHC:"}{" "}
            <strong>
              {state.attendance === "attending"
                ? "Attending"
                : state.attendance === "declined"
                  ? "Not attending"
                  : "Unknown"}
            </strong>
          </p>
          {state.deadline && (
            <p className="muted">
              Attendance deadline: {formatDate(state.deadline)} ·{" "}
              {formatTime(state.deadline)}
            </p>
          )}
          {!state.allowed && <p>{state.reason}</p>}
          {closed && state.allowed && (
            <p>The attendance deadline has passed.</p>
          )}
          {/* Both routes out, wherever this screen cannot make the change
              itself. The mailto opens a draft; the app never sends mail on
              anyone's behalf. */}
          {!allowed && (
            <p className="help">
              Request a change in Boathouse Connect, or email the coaches at{" "}
              <a
                href={`mailto:${COACHES_EMAIL}?subject=${encodeURIComponent(
                  `Attendance: ${outing.title}, ${formatDate(outing.starts_at)}`,
                )}`}
              >
                {COACHES_EMAIL}
              </a>
              .
            </p>
          )}
        </>
      )}
      {allowed && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(true);
          }}
        >
          <label>
            Your attendance
            <select
              aria-label="Your attendance"
              value={choice}
              disabled={busy}
              onChange={(e) =>
                setChoice(e.target.value as AttendanceChoice | "")
              }
            >
              <option value="">Choose attendance</option>
              <option value="attending">Attending</option>
              <option value="declined">Not attending</option>
            </select>
          </label>
          <p className="muted">
            {stagingPractice ? "Saving updates only this fictional practice." : "Saving updates your attendance in Boathouse Connect."}
          </p>
          <button
            className="primary"
            disabled={busy || !choice || choice === state?.attendance}
          >
            {stagingPractice ? "Save test attendance" : "Save attendance in BHC"}
          </button>
        </form>
      )}
      {busy && <p role="status">{stagingPractice ? "Checking test attendance…" : "Checking with BHC…"}</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {needsReconnect && (
        <button className="button" onClick={onReconnect}>
          Reconnect BHC
        </button>
      )}
      <div className="card-actions">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void send()}
        >
          Check BHC status
        </button>
        <a href={BHC_LOGIN_URL} target="_blank" rel="noopener noreferrer">
          Open Boathouse Connect
        </a>
      </div>
      <AttendanceRoster outingId={outing.id} user={user} onReconnect={onReconnect} />
    </Modal>
  );
}
