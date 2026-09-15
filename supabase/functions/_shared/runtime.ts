import { createClient } from "@supabase/supabase-js";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function env(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new HttpError(503, `${key} is not configured.`);
  return value;
}
export const service = () =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
export const userClient = (authorization: string) =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
export async function query(
  action: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await service().rpc("service_query", {
    action,
    args,
  });
  if (error) throw new HttpError(500, "The database operation failed.");
  return data;
}
export function check<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new HttpError(500, "The database operation failed.");
  return result.data;
}
export function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = (
    Deno.env.get("ALLOWED_ORIGINS") ||
    "http://localhost:5173,http://127.0.0.1:5173"
  ).split(",");
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin)
      ? origin
      : allowed[0],
    "Access-Control-Allow-Headers": "authorization,apikey,content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
}
export function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}
export async function body(req: Request, max = 32768) {
  if (Number(req.headers.get("content-length")) > max)
    throw new HttpError(413, "Request too large.");
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, "Request too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
export async function hash(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function enqueue(
  kind: string,
  user_id: string | null,
  outing_id: string | null,
  due: Date,
  key: string,
  payload: Record<string, unknown> = {},
) {
  return query("enqueue", {
    kind,
    user_id,
    outing_id,
    due_at: due.toISOString(),
    expires_at: new Date(due.getTime() + 86400000).toISOString(),
    dedupe_key: key,
    payload,
  });
}
export async function scheduleReminder(
  user: string,
  outing: { id: string; ends_at: string },
) {
  return enqueue(
    "reminder",
    user,
    outing.id,
    new Date(Date.parse(outing.ends_at) + 15 * 60000),
    `reminder:${user}:${outing.id}:${outing.ends_at}`,
  );
}
export async function seal(token: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(env("BHC_ENCRYPTION_KEY")), (c) => c.charCodeAt(0)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(token),
  );
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}
export async function unseal(ciphertext: string, iv: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(env("BHC_ENCRYPTION_KEY")), (c) => c.charCodeAt(0)),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Uint8Array.from(atob(iv), (c) => c.charCodeAt(0)),
      },
      key,
      Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0)),
    ),
  );
}
