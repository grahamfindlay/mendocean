import {
  mendotaClub,
  tokenMetadata,
  type BHCMethod,
} from "../../../shared/bhcConnection.ts";
import { bhcGet, generateBHCToken, list } from "./bhc-client.ts";
import { HttpError, query, seal, unseal, service, check } from "./runtime.ts";
import { liveProviders, type Providers } from "./providers.ts";
export const passwordBHCEnabled = () =>
  Deno.env.get("BHC_PASSWORD_CONNECT_ENABLED") === "true";
async function checkToken(token: string, providers: Providers) {
  const raw = await bhcGet("authenticate/checkApiKey", token, {}, providers);
  let metadata;
  try {
    metadata = tokenMetadata(raw, providers.now());
  } catch {
    throw new HttpError(
      502,
      "BHC returned an unexpected authentication response. Try again later.",
      "bhc_unavailable",
    );
  }
  if (!metadata || metadata.expired)
    throw new HttpError(
      409,
      "Reconnect Boathouse Connect to continue.",
      "bhc_reconnect_required",
    );
  return metadata;
}
async function resolveMendota(clubs: Record<string, any>[], userId: string) {
  let configured = (await query("bhc_config")).club_id;
  const explicit = Deno.env.get("BHC_MENDOTA_CLUB_ID");
  if (explicit) {
    const id = Number(explicit);
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      (configured && Number(configured) !== id)
    )
      throw new HttpError(
        503,
        "BHC club configuration needs administrator attention.",
        "bhc_configuration",
      );
    await query("bhc_configure", { club_id: id });
    configured = id;
  }
  let club;
  try {
    club = mendotaClub(clubs, configured ? Number(configured) : null);
  } catch {
    throw new HttpError(
      503,
      "More than one Mendota membership was found. Ask the administrator to configure the club.",
      "bhc_configuration",
    );
  }
  if (!club)
    throw new HttpError(
      409,
      "This BHC account isn't a member of Mendota Rowing Club.",
      "bhc_membership_missing",
    );
  if (!configured) {
    const profile = check(
      await service().from("profiles").select("role").eq("id", userId).single(),
    );
    if (profile?.role !== "admin")
      throw new HttpError(
        503,
        "The administrator needs to connect Mendota once before setup is available.",
        "bhc_configuration",
      );
    await query("bhc_configure", { club_id: club });
  }
  return club;
}
export async function connectBHC(
  userId: string,
  requestId: string,
  input: {
    token?: string;
    email?: string;
    password?: string;
    club_id?: number;
  },
  providers: Providers = liveProviders,
) {
  const method: BHCMethod = input.token
    ? "provided_token"
    : "password_exchange";
  if (method === "password_exchange" && !passwordBHCEnabled())
    throw new HttpError(
      503,
      "BHC password connection is not available yet. Use an API key instead.",
      "bhc_password_disabled",
    );
  const attempt = await query("bhc_connect_begin", {
    user_id: userId,
    request_id: requestId,
    method,
  });
  if (attempt.status === "completed") return { connected: true };
  if (attempt.status === "limited")
    throw new HttpError(
      429,
      "Too many connection attempts. Try again in 15 minutes.",
      "bhc_rate_limited",
    );
  if (attempt.status !== "started")
    throw new HttpError(
      409,
      "A BHC connection request is already in progress or was attempted. Check connection status before trying again.",
      "bhc_connection_busy",
    );
  try {
    const token =
      input.token ||
      (await generateBHCToken(input.email!, input.password!, providers));
    const metadata = await checkToken(token, providers);
    if (method === "password_exchange" && !metadata.expires_at)
      throw new HttpError(
        502,
        "BHC did not confirm the connection expiry. Use an API key instead.",
        "bhc_unavailable",
      );
    const club = await resolveMendota(
      list(await bhcGet("users/getAllWhitelabels", token, {}, providers)),
      userId,
    );
    if (input.club_id && input.club_id !== club)
      throw new HttpError(
        400,
        "Mendocean connects only to Mendota Rowing Club.",
        "bhc_membership_missing",
      );
    const saved = await query("connection_put", {
      user_id: userId,
      request_id: requestId,
      revision: attempt.revision,
      custid: metadata.custid,
      club_id: club,
      method,
      expires_at: metadata.expires_at,
      ...(await seal(token)),
    });
    if (!saved.saved) {
      if (saved.different_account)
        throw new HttpError(
          409,
          "This is a different BHC account. Sign in to the account you previously connected.",
          "bhc_different_account",
        );
      if (saved.already_linked)
        throw new HttpError(
          409,
          "This BHC account is already linked to another Mendocean account. Contact the administrator.",
          "bhc_already_linked",
        );
      throw new HttpError(
        409,
        "Your BHC connection changed. Check status before connecting again.",
        "bhc_connection_busy",
      );
    }
    return { connected: true };
  } catch (error) {
    await query("bhc_connect_fail", {
      user_id: userId,
      request_id: requestId,
      revision: attempt.revision,
    });
    throw error;
  }
}
export async function validateBHCConnection(
  connection: Record<string, any>,
  providers: Providers = liveProviders,
) {
  if (
    !connection.user_id ||
    connection.access_state === "reconnect_required" ||
    (connection.expires_at &&
      Date.parse(connection.expires_at) <= providers.now())
  )
    throw new HttpError(
      409,
      "Reconnect Boathouse Connect to continue.",
      "bhc_reconnect_required",
    );
  if (connection.access_state === "membership_missing")
    throw new HttpError(
      409,
      "Check your Mendota membership in BHC.",
      "bhc_membership_missing",
    );
  const token = await unseal(connection.ciphertext, connection.iv);
  const metadata = await checkToken(token, providers);
  const club = await resolveMendota(
    list(await bhcGet("users/getAllWhitelabels", token, {}, providers)),
    connection.user_id,
  );
  if (
    club !== Number(connection.club_id) ||
    metadata.custid !== Number(connection.custid)
  )
    throw new HttpError(
      409,
      "Check your Mendota membership in BHC.",
      "bhc_membership_missing",
    );
  await query("connection_checked", {
    user_id: connection.user_id,
    revision: connection.revision,
    expires_at: metadata.expires_at,
  });
  return token;
}
export async function recordBHCFailure(
  connection: Record<string, any>,
  error: unknown,
  providers: Providers,
) {
  let problem = error;
  if (!(
    problem instanceof HttpError &&
    ["bhc_reconnect_required", "bhc_membership_missing"].includes(
      problem.code || "",
    )
  )) {
    try {
      await checkToken(
        await unseal(connection.ciphertext, connection.iv),
        providers,
      );
    } catch (probe) {
      if (probe instanceof HttpError && probe.code === "bhc_reconnect_required")
        problem = probe;
    }
  }
  const state =
    problem instanceof HttpError
      ? problem.code === "bhc_reconnect_required"
        ? "reconnect_required"
        : problem.code === "bhc_membership_missing"
          ? "membership_missing"
          : undefined
      : undefined;
  await query("connection_problem", {
    user_id: connection.user_id,
    revision: connection.revision,
    ...(state ? { access_state: state } : {}),
    error:
      state === "reconnect_required"
        ? "Reconnect Boathouse Connect to continue."
        : state === "membership_missing"
          ? "Check your Mendota membership in BHC."
          : "Practice import failed. BHC could not update your practices. Try again later.",
  });
}
