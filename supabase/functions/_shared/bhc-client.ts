import { HttpError } from "./runtime.ts";
import { liveProviders, type Providers } from "./providers.ts";
const paths = new Set([
  "authenticate/checkApiKey",
  "users/getAllWhitelabels",
  "practices/getAthletePractices",
  "practices/getPractices",
  "equipment/getAllBoats",
]);
export function list(raw: any): Record<string, any>[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  throw new HttpError(
    502,
    "BHC returned an unexpected response.",
    "bhc_unavailable",
  );
}
export async function bhcGet(
  path: string,
  token: string,
  args: Record<string, string | number | boolean> = {},
  providers: Providers = liveProviders,
) {
  if (!paths.has(path)) throw new Error("BHC endpoint is not allowlisted.");
  const url = new URL("https://api.boathouseconnect.com/" + path);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(args))
    url.searchParams.set(key, String(value));
  // Never log token-bearing URLs, raw provider responses, or native fetch errors.
  try {
    const response = await providers.fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      if (path === "authenticate/checkApiKey" && response.status === 401)
        throw new HttpError(
          409,
          "Reconnect Boathouse Connect to continue.",
          "bhc_reconnect_required",
        );
      throw new Error();
    }
    return await response.json();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      502,
      "BHC is temporarily unavailable. Try again later.",
      "bhc_unavailable",
    );
  }
}
export async function generateBHCToken(
  email: string,
  password: string,
  providers: Providers,
) {
  try {
    const response = await providers.fetch(
      "https://api.boathouseconnect.com/authenticate/generateApiToken",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          email,
          password,
          apptokentype: "api",
        }).toString(),
      },
    );
    if ([401, 403].includes(response.status))
      throw new HttpError(
        400,
        "BHC didn't recognize that email and password. Check them and try again.",
        "bhc_credentials",
      );
    if (!response.ok) throw new Error();
    const raw = await response.json();
    if (
      (Array.isArray(raw) && raw.length === 0) ||
      (raw?.status === "Error" && raw?.error === "email, or password incorrect")
    )
      throw new HttpError(
        400,
        "BHC didn't recognize that email and password. Check them and try again.",
        "bhc_credentials",
      );
    if (
      !raw ||
      typeof raw.token !== "string" ||
      raw.token.length < 20 ||
      raw.token.length > 200
    )
      throw new Error();
    return raw.token as string;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      502,
      "BHC could not confirm the connection. Check connection status before trying again.",
      "bhc_unavailable",
    );
  }
}
