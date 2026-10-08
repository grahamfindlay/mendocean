import { RefreshCw } from "lucide-react";
import {
  type Lineup,
  type LineupBoat,
  type LineupSeat,
  ownBoat,
  seatLabel,
} from "../shared/lineups";
import {
  OAR_PATH,
  boatSeatCount,
  coachMailto,
  oarSides,
} from "../shared/lineup-display";
import { formatDate, formatTime } from "../shared/domain";
import { BHCNotice } from "./BHCConnection";
import type { BHCConnectionStatus } from "../shared/bhcConnection";
import "./LineupsView.css";

function Seat({ seat, count }: { seat: LineupSeat; count: number }) {
  const sides = oarSides(seat);
  const label = seatLabel(seat.seat, count);
  const accessible =
    seat.seat !== "coxswain" && seat.side ? `${label}, ${seat.side}` : label;
  return (
    <span
      className="lineup-seat-label"
      aria-label={accessible}
      title={accessible}
    >
      <svg
        className={sides.left ? "lineup-oar" : "lineup-oar lineup-oar-empty"}
        width="24"
        height="17"
        viewBox="0 0 32 22"
        aria-hidden="true"
      >
        <path d={OAR_PATH} />
      </svg>
      <span aria-hidden="true">{label}</span>
      <svg
        className={
          sides.right
            ? "lineup-oar lineup-oar-right"
            : "lineup-oar lineup-oar-empty"
        }
        width="24"
        height="17"
        viewBox="0 0 32 22"
        aria-hidden="true"
      >
        <path d={OAR_PATH} />
      </svg>
    </span>
  );
}
function Boat({
  boat,
  lineup,
  own,
}: {
  boat: LineupBoat;
  lineup: Lineup;
  own: boolean;
}) {
  const count = boatSeatCount(boat);
  return (
    <article className={`lineup-boat${own ? " lineup-own-boat" : ""}`}>
      <header className="lineup-boat-heading">
        {own && <p className="lineup-kicker">Your boat</p>}
        <h2>
          {boat.name}
          {boat.boat_class && (
            <span className="lineup-class">{boat.boat_class}</span>
          )}
        </h2>
      </header>
      <ol className="lineup-seats">
        {boat.seats.map((s) => (
          <li
            key={s.seat}
            className={s.athlete_id === lineup.athlete_id ? "lineup-you" : ""}
          >
            <Seat seat={s} count={count} />
            <span className="lineup-athlete">{s.name}</span>
            {s.athlete_id === lineup.athlete_id && (
              <strong className="lineup-you-label">You</strong>
            )}
          </li>
        ))}
      </ol>
      {!!boat.coaches.length && (
        <footer className="lineup-coaches">
          <span>{boat.coaches.length > 1 ? "Coaches" : "Coach"}</span>
          <div>
            {boat.coaches.map((c, i) => {
              const href = coachMailto(c.email, lineup);
              return (
                <span key={c.athlete_id}>
                  {i > 0 && ", "}
                  {href ? <a href={href}>{c.name}</a> : c.name}
                </span>
              );
            })}
          </div>
        </footer>
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
  const boat = current && ownBoat(current);
  const other = current?.boats.filter((b) => b.boat_id !== boat?.boat_id) ?? [];
  const minutes = current?.checked_at
    ? Math.max(0, Math.floor((now - Date.parse(current.checked_at)) / 60000))
    : null;
  const stale = !!(
    status.lineup_error ||
    status.last_error ||
    (minutes !== null && minutes > 15)
  );
  return (
    <section className="lineups-view">
      <div className="lineups-heading">
        <h1>Lineups</h1>
        <button
          className="lineup-refresh"
          disabled={busy || !status.connected || !enabled}
          onClick={onRefresh}
          aria-label="Check for lineup updates"
        >
          <RefreshCw size={15} className={busy ? "lineup-refresh-busy" : ""} />
          {busy ? "Checking…" : "Refresh"}
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
            <label className="lineup-practice-picker">
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
              <header className="lineup-practice">
                <h2>{current.title}</h2>
                <p>
                  {formatDate(current.starts_at)} <span>·</span>{" "}
                  {formatTime(current.starts_at)} –{" "}
                  {formatTime(current.ends_at)}
                </p>
              </header>
              {boat ? (
                <Boat boat={boat} lineup={current} own />
              ) : (
                <div className="lineup-unassigned">
                  <h2>No seat assigned</h2>
                  <p>Check with your coach about your assignment.</p>
                </div>
              )}
              {current.plan && (
                <section className="lineup-plan">
                  <h2>Practice plan</h2>
                  <p>{current.plan}</p>
                </section>
              )}
              {!!other.length && (
                <details className="lineup-other">
                  <summary>Other boats ({other.length})</summary>
                  <div className="lineup-boat-grid">
                    {other.map((b) => (
                      <Boat
                        key={b.boat_id}
                        boat={b}
                        lineup={current}
                        own={false}
                      />
                    ))}
                  </div>
                </details>
              )}
              <p
                className={`lineup-freshness${stale ? " lineup-stale" : ""}`}
                role="status"
              >
                {minutes === null
                  ? "Waiting for a freshness check"
                  : minutes < 1
                    ? "Checked just now"
                    : minutes === 1
                      ? "Checked 1 minute ago"
                      : `Checked ${minutes} minutes ago`}
                {stale && (
                  <span>
                    Updates couldn’t be confirmed. Showing the last saved
                    lineup.
                  </span>
                )}
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
