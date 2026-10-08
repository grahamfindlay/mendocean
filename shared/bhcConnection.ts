export type BHCMethod = "provided_token" | "password_exchange" | "unknown";
export interface BHCConnectionStatus {
  connected: boolean;
  last_sync: string | null;
  last_error: string | null;
  lineup_error?: string | null;
  state?:
    | "not_connected"
    | "importing"
    | "healthy"
    | "reconnect_required"
    | "membership_missing"
    | "temporary_error"
    | "import_incomplete";
  method?: BHCMethod;
  expires_at?: string | null;
  renewal_due?: boolean;
  club_name?: string;
  password_enabled?: boolean;
  upcoming_practices?: number;
}
export function tokenMetadata(raw: unknown, now: number) {
  if (Array.isArray(raw) && raw.length === 0) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Unexpected authentication response");
  const value = raw as Record<string, unknown>;
  // Verified live: rejected tokens return HTTP 200 with this error envelope.
  // Other provider errors remain transient rather than invalidating a connection.
  if (
    value.status === "error" &&
    value.custid === null &&
    value.token_id === null &&
    value.message ===
      "Token was not found, or is expired. Do not attempt to re-use this token."
  )
    return null;
  const custid = Number(value.custid);
  if (!Number.isSafeInteger(custid) || custid <= 0)
    throw new Error("Unexpected authentication response");
  const seconds = Number(value.expires);
  // Zero/missing expiry means unknown; do not manufacture a six-month date.
  const expires =
    Number.isFinite(seconds) && seconds > 0 && seconds < 253402300800
      ? new Date(seconds * 1000).toISOString()
      : null;
  return {
    custid,
    expires_at: expires,
    expired: !!expires && Date.parse(expires) <= now,
  };
}
export function mendotaClub(
  clubs: Record<string, unknown>[],
  configured: number | null,
) {
  const valid = clubs.filter(
    (c) =>
      Number.isSafeInteger(Number(c.whitelabel_id)) &&
      Number(c.whitelabel_id) > 0,
  );
  if (configured)
    return valid.some((c) => Number(c.whitelabel_id) === configured)
      ? configured
      : null;
  const matches = [
    ...new Set(
      valid
        .filter(
          (c) =>
            typeof c.whitelabel_name === "string" &&
            c.whitelabel_name.toLowerCase().includes("mendota"),
        )
        .map((c) => Number(c.whitelabel_id)),
    ),
  ];
  if (matches.length > 1) throw new Error("Ambiguous Mendota membership");
  return matches[0] ?? null;
}
export function bhcStatus(
  connection: Record<string, any>,
  now: number,
  passwordEnabled = false,
): BHCConnectionStatus {
  const base = {
    password_enabled: passwordEnabled,
    club_name: "Mendota Rowing Club",
    method: (connection.method || "unknown") as BHCMethod,
    expires_at: connection.expires_at || null,
    last_sync: connection.last_successful_sync_at || null,
    last_error: connection.last_error || null,
    lineup_error: connection.lineup_error || null,
  };
  if (!connection.user_id)
    return { ...base, connected: false, state: "not_connected" };
  const expired =
    connection.expires_at && Date.parse(connection.expires_at) <= now;
  const state =
    connection.access_state === "membership_missing"
      ? "membership_missing"
      : expired || connection.access_state === "reconnect_required"
        ? "reconnect_required"
        : connection.last_error
          ? "temporary_error"
          : connection.import_status === "failed"
            ? "import_incomplete"
            : connection.import_status === "pending"
              ? "importing"
              : "healthy";
  return {
    ...base,
    state,
    connected: !["reconnect_required", "membership_missing"].includes(state),
    renewal_due:
      state !== "reconnect_required" &&
      !!connection.expires_at &&
      Date.parse(connection.expires_at) - now <= 7 * 86400000,
  };
}
