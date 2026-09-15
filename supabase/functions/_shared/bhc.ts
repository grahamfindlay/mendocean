import { normalizePractice, syncTimes } from "../../../shared/bhc.ts";
import {
  check,
  enqueue,
  HttpError,
  query,
  scheduleReminder,
  service,
  unseal,
} from "./runtime.ts";
const PATHS = new Set([
  "authenticate/checkApiKey",
  "users/getAllWhitelabels",
  "practices/getAthletePractices",
  "practices/getPractices",
  "equipment/getAllBoats",
]);
export function list(raw: any): Record<string, any>[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  throw new HttpError(502, "BHC returned an unexpected response.");
}
export async function bhcGet(
  path: string,
  token: string,
  args: Record<string, string | number | boolean> = {},
) {
  if (!PATHS.has(path)) throw new Error("BHC endpoint is not allowlisted.");
  const url = new URL("https://api.boathouseconnect.com/" + path);
  url.searchParams.set("token", token);
  for (const [key, value] of Object.entries(args))
    url.searchParams.set(key, String(value));
  // BHC requires the token in the query. Never log URLs, response bodies, or native fetch errors here.
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch {
    throw new HttpError(
      502,
      "BHC could not be reached or rejected this token. Try again or reconnect your account.",
    );
  }
}
export async function syncBHC(uid: string, initial = false, afterId = 0) {
  const connection = await query("connection_get", { user_id: uid });
  if (!connection.user_id) return;
  const lock = await query("sync_lock", { user_id: uid });
  if (!lock.acquired) return;
  const started = Date.now();
  try {
    const token = await unseal(connection.ciphertext, connection.iv);
    const club = connection.club_id;
    const args = { whitelabel_id: club, custid: connection.custid };
    const upcoming = list(
      await bhcGet("practices/getAthletePractices", token, {
        ...args,
        upcoming: true,
      }),
    );
    // Include recent practices on every sync so the post-practice lineup refresh can still find them.
    const past = list(
      await bhcGet("practices/getAthletePractices", token, {
        ...args,
        upcoming: false,
      }),
    ).filter(
      (p) =>
        Number(p.end_time) * 1000 > Date.now() - (initial ? 30 : 2) * 86400000,
    );
    const practices = [
      ...new Map(
        [...upcoming, ...past].map((p) => [Number(p.practice_id), p]),
      ).values(),
    ];
    const remaining = practices
      .filter((p) => Number(p.practice_id) > afterId)
      .sort((a, b) => Number(a.practice_id) - Number(b.practice_id));
    let completed = 0;
    let cursor = afterId;
    const boats = list(
      await bhcGet("equipment/getAllBoats", token, { whitelabel_id: club }),
    );
    const db = service();
    for (const meta of remaining) {
      if (completed >= 12 || Date.now() - started > 50000) {
        await enqueue(
          "bhc_sync",
          uid,
          null,
          new Date(),
          `bhc-continuation:${uid}:${cursor}:${Math.floor(Date.now() / 300000)}`,
          { initial, after_id: cursor },
        );
        return;
      }
      const detailRaw = await bhcGet("practices/getPractices", token, {
        ...args,
        practice_id: Number(meta.practice_id),
        meta_only: "No",
        upcoming: false,
      });
      const detail = Array.isArray(detailRaw) ? detailRaw[0] || {} : detailRaw;
      const p = normalizePractice(meta, detail, connection.custid, boats);
      const outing = check(
        await db
          .from("outings")
          .upsert(
            {
              kind: "official",
              bhc_club_id: club,
              bhc_practice_id: p.bhc_practice_id,
              title: p.title,
              starts_at: p.starts_at,
              ends_at: p.ends_at,
              planned_coaches: p.planned_coaches,
              planned_boats: p.planned_boats,
            },
            { onConflict: "bhc_club_id,bhc_practice_id" },
          )
          .select()
          .single(),
      );
      const prior = check(
        await db
          .from("outing_members")
          .select("skipped,reminder")
          .eq("outing_id", outing.id)
          .eq("user_id", uid)
          .maybeSingle(),
      );
      check(
        await db.from("outing_members").upsert(
          {
            outing_id: outing.id,
            user_id: uid,
            attendance: p.attendance,
            deadline: p.deadline,
            planned_boat: p.planned_boat,
            planned_seat: p.planned_seat,
            reminder: p.attendance === "attending" && !prior?.skipped,
            skipped: prior?.skipped || false,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "outing_id,user_id" },
        ),
      );
      if (
        p.attendance === "attending" &&
        !prior?.skipped &&
        Date.parse(p.ends_at) > Date.now() - 86400000
      )
        await scheduleReminder(uid, outing);
      for (const due of syncTimes(p))
        await enqueue(
          "bhc_sync",
          uid,
          null,
          new Date(due),
          `bhc:${uid}:${Math.floor(due / 300000)}`,
        );
      completed++;
      cursor = Number(meta.practice_id);
    }
    await query("connection_synced", { user_id: uid, error: null });
  } catch {
    await query("connection_synced", {
      user_id: uid,
      error:
        "Practice import failed. Try refreshing or reconnecting your BHC account.",
    });
    throw new Error("BHC sync failed.");
  } finally {
    await query("sync_unlock", { user_id: uid });
  }
}
