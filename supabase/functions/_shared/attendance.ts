import { attendanceState, type AttendanceChoice } from "../../../shared/bhc.ts";
import { bhcGet, list } from "./bhc.ts";
import {
  check,
  enqueue,
  HttpError,
  query,
  service,
  unseal,
} from "./runtime.ts";
import { liveProviders, type Providers } from "./providers.ts";

export async function manageAttendance(
  uid: string,
  outingId: string,
  change?: {
    attendance: AttendanceChoice;
    expected: string;
    request_id: string;
  },
  providers: Providers = liveProviders,
) {
  const db = service();
  // Caller has already checked membership through the authenticated RLS client.
  const outing = check(
    await db.from("outings").select("*").eq("id", outingId).single(),
  );
  if (outing.kind !== "official")
    throw new HttpError(400, "Only BHC practices have attendance choices.");
  const lock = await query("sync_lock", { user_id: uid });
  if (!lock.acquired)
    throw new HttpError(
      409,
      "BHC is disconnected or syncing. Wait a moment, then check again.",
    );
  try {
    const connection = await query("connection_get", { user_id: uid });
    if (!connection.user_id || connection.club_id !== outing.bhc_club_id)
      throw new HttpError(
        409,
        "Connect the BHC account for this practice in Account.",
      );
    const token = await unseal(connection.ciphertext, connection.iv);
    const read = async () => {
      const practices = list(
        await bhcGet(
          "practices/getAthletePractices",
          token,
          {
            whitelabel_id: connection.club_id,
            custid: connection.custid,
            upcoming: true,
          },
          providers,
        ),
      );
      const meta = practices.find(
        (p) => Number(p.practice_id) === Number(outing.bhc_practice_id),
      );
      if (!meta)
        throw new HttpError(
          409,
          "This practice is no longer available to this BHC account. Open Boathouse Connect to check it.",
        );
      const state = attendanceState(meta, providers.now());
      check(
        await db.rpc("apply_bhc_attendance", {
          uid,
          outing: outingId,
          choice: state.attendance,
          deadline: state.deadline,
        }),
      );
      return state;
    };
    let state = await read();
    if (!change) return { state, outcome: "checked" };
    if (state.attendance === change.attendance)
      return { state, outcome: "confirmed" };
    if (state.attendance !== change.expected)
      return {
        state,
        outcome: "conflict",
        message:
          "Attendance changed in BHC. Review its current status before choosing again.",
      };
    if (!state.allowed)
      return { state, outcome: "blocked", message: state.reason };
    const currentConnection = await query("connection_get", { user_id: uid });
    if (
      currentConnection.ciphertext !== connection.ciphertext ||
      currentConnection.club_id !== connection.club_id
    )
      throw new HttpError(
        409,
        "Your BHC connection changed. Check status again before saving.",
      );
    const claimed = check(
      await db.rpc("claim_bhc_attendance", {
        uid,
        request: change.request_id,
        outing: outingId,
        choice: change.attendance,
      }),
    );
    if (!claimed)
      return {
        state,
        outcome: "unconfirmed",
        message:
          "This request was already attempted. BHC has not confirmed the requested attendance. Check BHC before making another change.",
      };
    if (state.deadline && providers.now() >= Date.parse(state.deadline))
      return {
        state: { ...state, allowed: false },
        outcome: "blocked",
        message:
          "The attendance deadline has passed. Request changes in Boathouse Connect.",
      };
    // Submit only our authenticated athlete: never accept or send a caller-supplied custid.
    // A failed transport may still have changed BHC, so always read back and never retry POST.
    try {
      await providers.fetch(
        "https://api.boathouseconnect.com/practices/setAttendance",
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token,
            whitelabel_id: String(connection.club_id),
            practice_id: String(outing.bhc_practice_id),
            attendance:
              change.attendance === "attending" ? "Attending" : "Not Attending",
          }).toString(),
        },
      );
    } catch {
      /* Reconcile ambiguous acceptance below; never log provider errors/tokens. */
    }
    try {
      state = await read();
    } catch {
      return {
        state: null,
        outcome: "unconfirmed",
        message:
          "BHC may have received your change, but its status could not be confirmed. Check status before trying again.",
      };
    }
    return state.attendance === change.attendance
      ? { state, outcome: "confirmed" }
      : {
          state,
          outcome: "unconfirmed",
          message:
            state.reason ||
            "BHC did not confirm this change. The practice may be full or restricted. Check BHC before trying again.",
        };
  } finally {
    await query("sync_unlock", { user_id: uid });
    // Normal read-only import refreshes lineups and practice details after reconciliation.
    await enqueue(
      "bhc_sync",
      uid,
      null,
      new Date(),
      `bhc-attendance:${uid}:${Date.now()}`,
    );
  }
}
