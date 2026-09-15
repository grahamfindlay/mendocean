import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { randomUUID } from "node:crypto";
export function localURL(name: string) {
  const u = new URL(process.env[name] || "https://refuse.invalid");
  if (
    process.env.TEST_STACK !== "local-only" ||
    !["127.0.0.1", "localhost"].includes(u.hostname)
  )
    throw new Error("Test helper refuses nonlocal target: " + name);
  return u.href.replace(/\/$/, "");
}
export const url = localURL("TEST_SUPABASE_URL");
export const anon = process.env.TEST_ANON_KEY!;
export const secret = process.env.TEST_FIXTURE_SECRET!;
export const db = createClient(url, process.env.TEST_SERVICE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
export const sql = new pg.Pool({
  connectionString: localURL("TEST_DATABASE_URL"),
  max: 4,
});
export const publicClient = () =>
  createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
export type Actor = {
  id: string;
  email: string;
  token: string;
  client: ReturnType<typeof publicClient>;
};
export async function user(approved = true): Promise<Actor> {
  const email = `test-${randomUUID()}@example.test`;
  const password = randomUUID() + "Aa9!";
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const id = data.user.id;
  const p = await db.from("profiles").update({ approved }).eq("id", id);
  if (p.error) throw p.error;
  const client = publicClient();
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { id, email, token: signed.data.session.access_token, client };
}
export async function api(actor: Actor | null, path: string, body?: unknown) {
  const r = await fetch(`${url}/functions/v1/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${actor?.token || anon}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
export async function tick() {
  const r = await fetch(url + "/functions/v1/jobs", {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: "Bearer " + secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "tick" }),
  });
  if (r.status !== 200) throw new Error("Dispatcher failed " + r.status);
  return r.json();
}
export async function fixtures(patch?: Record<string, unknown>) {
  const r = await fetch(
    "http://127.0.0.1:54328/" + (patch ? "control" : "state"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-fixture-secret": secret,
      },
      body: JSON.stringify(patch || {}),
    },
  );
  if (!r.ok) throw new Error("Fixture control failed");
  return r.json();
}
export async function resetJobs() {
  await sql.query("truncate private.jobs restart identity");
  await fixtures({
    bhc: [],
    lineup: false,
    failure: null,
    deliveries: [],
    attempts: [],
    calls: [],
  });
}
export function outing(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    kind: "independent",
    title: "Synthetic row " + randomUUID().slice(0, 8),
    starts_at: new Date(Date.now() - 7200000).toISOString(),
    ends_at: new Date(Date.now() - 3600000).toISOString(),
    planned_boat: null,
    reminder: false,
    ...overrides,
  };
}
export async function createOuting(
  actor: Actor,
  overrides: Record<string, unknown> = {},
) {
  const o = outing(overrides);
  const r = await api(actor, "outing", o);
  if (r.status !== 200) throw new Error(JSON.stringify(r));
  return o;
}
export async function cleanupUsers(actors: Actor[]) {
  for (const a of actors) await db.auth.admin.deleteUser(a.id);
}
export async function enqueue(
  kind: string,
  uid: string | null = null,
  oid: string | null = null,
  payload = {},
) {
  await sql.query(
    "insert into private.jobs(kind,user_id,outing_id,due_at,expires_at,dedupe_key,payload) values($1,$2,$3,now()-interval '1 second',now()+interval '1 day',$4,$5)",
    [kind, uid, oid, randomUUID(), payload],
  );
}
export async function ensureWeather() {
  await resetJobs();
  await tick();
}
export const syntheticToken = "synthetic-bhc-token-for-tests-only";
export function practice(id: number, status = "attending") {
  return {
    practice_id: id,
    name: "Fixture practice " + id,
    start_time: Math.floor(Date.now() / 1000) - 7200,
    end_time: Math.floor(Date.now() / 1000) - 3600,
    attendance_window_end: Math.floor(Date.now() / 1000) - 86400,
    current_attendance_status: status,
  };
}
