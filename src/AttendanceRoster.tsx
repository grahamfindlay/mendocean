import { useEffect, useRef, useState } from "react";
import type { AttendanceRoster as Roster } from "../shared/attendanceRoster";
import { formatDate, formatTime } from "../shared/domain";
import { api, ApiError } from "./client";

export function AttendanceRoster({
  outingId,
  user,
  onReconnect,
}: {
  outingId: string;
  user: string;
  onReconnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<Roster>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  async function load() {
    const id = ++request.current;
    setBusy(true);
    setError("");
    setNeedsReconnect(false);
    try {
      if (!navigator.onLine)
        throw new Error("Connect to the internet to check who is attending.");
      const result = await api<Roster>(
        "bhc/attendance-roster",
        { outing_id: outingId },
        user,
      );
      if (id === request.current) setRoster(result);
    } catch (e) {
      if (id !== request.current) return;
      setError((e as Error).message);
      setNeedsReconnect(
        e instanceof ApiError && e.code === "bhc_reconnect_required",
      );
      // Do not keep displaying private names after loss of access.
      setRoster(undefined);
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (open && !roster && !error) void load();
  }, [open]);

  return (
    <details
      className="attendance-roster"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        Who else is attending{roster ? ` (${roster.attendees.length})` : ""}
      </summary>
      {busy && <p role="status">Checking attendance with BHC…</p>}
      {roster && (
        <>
          {roster.attendees.length ? (
            <ul aria-label="Other attendees">
              {roster.attendees.map((person) => (
                <li key={person.id}>{person.name}</li>
              ))}
            </ul>
          ) : (
            <p>No one else is marked attending in BHC.</p>
          )}
          <p className="muted">
            Checked {formatDate(roster.checked_at)} ·{" "}
            {formatTime(roster.checked_at)}
          </p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {needsReconnect ? (
        <button type="button" className="text-button" onClick={onReconnect}>
          Reconnect BHC
        </button>
      ) : (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => void load()}
        >
          {error ? "Try again" : "Refresh attendees"}
        </button>
      )}
    </details>
  );
}
