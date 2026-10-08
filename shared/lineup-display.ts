import type { Lineup, LineupBoat, LineupSeat } from "./lineups.ts";
import { formatDate } from "./domain.ts";

// Blade on the left: starboard as seen by a rower facing the stern.
export const OAR_PATH = "M2 8.5Q2 7 4 7H10L13 10H30V12H13L10 15H4Q2 15 2 13.5Z";
export const boatSeatCount = (boat: LineupBoat) =>
  Number(boat.boat_class?.[0]) ||
  Math.max(0, ...boat.seats.map((s) => Number(s.seat) || 0));
export function oarSides(seat: LineupSeat) {
  const side = seat.seat === "coxswain" ? null : seat.side;
  return {
    left: side === "starboard" || side === "sculling",
    right: side === "port" || side === "sculling",
  };
}
export function contactEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const email = value.trim();
  // Only a bare address may become a mailto link; reject header/URL syntax.
  if (
    email.length <= 254 &&
    /^[A-Za-z0-9.!#$%&'*+/=_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(
      email,
    )
  )
    return email;
}
export function coachMailto(
  email: unknown,
  lineup: Pick<Lineup, "title" | "starts_at">,
) {
  const address = contactEmail(email);
  return address
    ? `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(`${lineup.title} — ${formatDate(lineup.starts_at)}`)}`
    : undefined;
}
