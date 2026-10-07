import { RefreshCw } from "lucide-react";
import {
  type Lineup,
  type LineupBoat,
  ownBoat,
  ownSeat,
  seatLabel,
} from "../shared/lineups";
import { formatDate, formatTime } from "../shared/domain";
import { BHCNotice } from "./BHCConnection";
import type { BHCConnectionStatus } from "../shared/bhcConnection";
import "./LineupsView.css";

function Boat({
  boat,
  athlete,
  own,
}: {
  boat: LineupBoat;
  athlete: number;
  own: boolean;
}) {
  const count =
    Number(boat.boat_class?.[0]) ||
    Math.max(...boat.seats.map((s) => Number(s.seat) || 0));
  return (
    <article className={`lineup-boat${own ? " lineup-own-boat" : ""}`}>
      <h2>
        {own && <span className="lineup-kicker">Your boat</span>}
        {boat.name}{" "}
        {boat.boat_class && (
          <span className="lineup-class">{boat.boat_class}</span>
        )}
      </h2>
      <ol className="lineup-seats">
        {boat.seats.map((s) => (
          <li
            key={s.seat}
            className={s.athlete_id === athlete ? "lineup-you" : ""}
          >
            <span className="lineup-seat-label">
              {seatLabel(s.seat, count)}
            </span>
            <span className="lineup-athlete">
              {s.name}
              {s.athlete_id === athlete && (
                <strong className="lineup-you-label">You</strong>
              )}
            </span>
            {s.side && <span className="lineup-side">{s.side}</span>}
          </li>
        ))}
      </ol>
      {!!boat.coaches.length && (
        <p className="lineup-coaches">
          Coach: {boat.coaches.map((c) => c.name).join(", ")}
        </p>
      )}
    </article>
  );
}
export default function LineupsView({
  lineups,
  status,
  enabled,
  selected,
  onSelect,
  now,
  busy,
  onRefresh,
  onReconnect,
}: {
  lineups: Lineup[];
  status: BHCConnectionStatus;
  enabled: boolean;
  selected?: string;
  onSelect: (id: string) => void;
  now: number;
  busy: boolean;
  onRefresh: () => void;
  onReconnect: () => void;
}) {
  const practices = lineups
    .filter((l) => l.published && Date.parse(l.ends_at) > now)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const current = selected
    ? practices.find((l) => l.outing_id === selected)
    : practices[0];
  const boat = current && ownBoat(current),
    seat = current && ownSeat(current);
  const other = current?.boats.filter((b) => b.boat_id !== boat?.boat_id) ?? [];
  return (
    <section className="lineups-view">
      <div className="section-heading">
        <h1>Lineups</h1>
        <button
          className="button subtle"
          disabled={busy || !status.connected || !enabled}
          onClick={onRefresh}
        >
          <RefreshCw size={16} />
          Check for updates
        </button>
      </div>
      <BHCNotice status={status} onReconnect={onReconnect} />
      {!enabled ? (
        <p>Lineups are awaiting connection verification.</p>
      ) : !practices.length ? (
        <div className="empty-state">
          <h2>No published lineups yet</h2>
          <p>
            Your published lineups will appear here for practices you’re
            attending.
          </p>
        </div>
      ) : (
        <>
          {practices.length > 1 && (
            <label>
              Practice
              <select
                value={current?.outing_id ?? ""}
                onChange={(e) => onSelect(e.target.value)}
              >
                {!current && <option value="">Choose a practice</option>}
                {practices.map((l) => (
                  <option key={l.outing_id} value={l.outing_id}>
                    {formatDate(l.starts_at)} · {formatTime(l.starts_at)} ·{" "}
                    {l.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!current ? (
            <>
              <p>
                This practice’s lineup is no longer available. It may have been
                withdrawn, or the practice may have ended.
              </p>
              <button
                className="button subtle"
                onClick={() => onSelect(practices[0].outing_id!)}
              >
                View next practice
              </button>
            </>
          ) : (
            <>
              <div className="lineup-practice">
                <h2>{current.title}</h2>
                <p>
                  {formatDate(current.starts_at)} ·{" "}
                  {formatTime(current.starts_at)} –{" "}
                  {formatTime(current.ends_at)}
                </p>
                {current.location && <p>{current.location}</p>}
                {seat && (
                  <p className="lineup-assignment">
                    {boat!.name} ·{" "}
                    {seatLabel(seat.seat, Number(boat!.boat_class?.[0]) || 8)}
                  </p>
                )}
                <p className="help" role="status">
                  {current.checked_at
                    ? `Checked ${Math.max(0, Math.floor((now - Date.parse(current.checked_at)) / 60000))} minutes ago.`
                    : "Waiting for a freshness check."}{" "}
                  {status.lineup_error ||
                  status.last_error ||
                  (current.checked_at &&
                    now - Date.parse(current.checked_at) > 15 * 60000)
                    ? "Updates could not be confirmed. This is the last saved lineup."
                    : ""}
                </p>
              </div>
              {boat ? (
                <Boat boat={boat} athlete={current.athlete_id} own />
              ) : (
                <p className="notice">
                  You have not been assigned a seat. Check with your coach.
                </p>
              )}
              {!!other.length && (
                <details className="lineup-other">
                  <summary>Other boats ({other.length})</summary>
                  <div className="lineup-boat-grid">
                    {other.map((b) => (
                      <Boat
                        key={b.boat_id}
                        boat={b}
                        athlete={current.athlete_id}
                        own={false}
                      />
                    ))}
                  </div>
                </details>
              )}
              {current.plan && (
                <div className="lineup-plan">
                  <h2>Practice plan</h2>
                  <p>{current.plan}</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
