import {
  normalizeAttendanceRoster,
  type AttendanceRoster,
} from "../../../shared/attendanceRoster.ts";
import { validateBHCConnection, recordBHCFailure } from "./bhc-connection.ts";
import { bhcGet, list } from "./bhc-client.ts";
import { check, HttpError, query, service } from "./runtime.ts";
import { liveProviders, type Providers } from "./providers.ts";

export async function readAttendanceRoster(
  uid: string,
  outingId: string,
  providers: Providers = liveProviders,
): Promise<AttendanceRoster> {
  // The API has checked the caller's outing membership with its RLS client.
  const outing = check(
    await service().from("outings").select("*").eq("id", outingId).single(),
  );
  if (outing.kind !== "official")
    throw new HttpError(400, "Only BHC practices have attendance lists.");
  const connection = await query("connection_get", { user_id: uid });
  if (!connection.user_id || connection.access_state === "reconnect_required")
    throw new HttpError(
      409,
      "Reconnect Boathouse Connect to see attendance.",
      "bhc_reconnect_required",
    );
  if (connection.access_state === "membership_missing")
    throw new HttpError(
      409,
      "Check your Mendota membership in BHC.",
      "bhc_membership_missing",
    );
  if (Number(connection.club_id) !== Number(outing.bhc_club_id))
    throw new HttpError(
      409,
      "Connect the BHC account for this practice in Account.",
    );
  try {
    const token = await validateBHCConnection(connection, providers);
    const args = {
      whitelabel_id: connection.club_id,
      custid: connection.custid,
      upcoming: true,
    };
    const practices = list(
      await bhcGet("practices/getAthletePractices", token, args, providers),
    );
    if (
      !practices.some(
        (p) => Number(p.practice_id) === Number(outing.bhc_practice_id),
      )
    )
      throw new HttpError(
        409,
        "This practice is no longer available to your BHC account. Open Boathouse Connect to check it.",
      );
    const raw = await bhcGet(
      "practices/getPractices",
      token,
      {
        ...args,
        practice_id: Number(outing.bhc_practice_id),
        meta_only: "No",
      },
      providers,
    );
    let attendees;
    try {
      attendees = normalizeAttendanceRoster(
        Array.isArray(raw) ? raw[0] : raw,
        Number(connection.custid),
      );
    } catch {
      throw new HttpError(
        502,
        "BHC could not provide the attendance list. Try again later.",
        "bhc_unavailable",
      );
    }
    const current = await query("connection_get", { user_id: uid });
    if (
      !current.user_id ||
      current.access_state !== "active" ||
      current.revision !== connection.revision ||
      current.ciphertext !== connection.ciphertext ||
      Number(current.club_id) !== Number(connection.club_id) ||
      (current.expires_at && Date.parse(current.expires_at) <= providers.now())
    )
      throw new HttpError(
        409,
        "Your BHC connection changed. Check attendance again.",
      );
    return { attendees, checked_at: new Date(providers.now()).toISOString() };
  } catch (error) {
    // Record confirmed credential/membership failures, without turning a roster
    // transport failure into a failed practice import or enqueueing sync work.
    if (
      error instanceof HttpError &&
      ["bhc_reconnect_required", "bhc_membership_missing"].includes(
        error.code || "",
      )
    )
      await recordBHCFailure(connection, error, providers);
    throw error;
  }
}
