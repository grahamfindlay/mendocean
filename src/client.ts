import { createClient } from "@supabase/supabase-js";
import type { Forecast } from "../shared/domain";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export const previewMode =
  import.meta.env.DEV &&
  new URLSearchParams(location.search).get("preview") === "1";
export async function api<T>(
  path: string,
  body?: unknown,
  expectedUser?: string,
): Promise<T> {
  if (previewMode)
    return (await import("./dev-preview")).previewAPI(path, body) as Promise<T>;
  if (!supabase)
    throw new Error(
      "Account services are awaiting Supabase setup. Public weather is available in this local preview.",
    );
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (expectedUser && session?.user.id !== expectedUser)
    throw new Error(
      "Sign back into the account that created this report before uploading it.",
    );
  const response = await fetch(`${url}/functions/v1/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${session?.access_token || key}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Unable to complete this request.");
  return data as T;
}
export async function getWeather(): Promise<Forecast> {
  if (supabase && !previewMode) return api<Forecast>("weather");
  if (!import.meta.env.DEV)
    throw new Error("Weather service has not been configured.");
  const response = await fetch("/api/weather");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
