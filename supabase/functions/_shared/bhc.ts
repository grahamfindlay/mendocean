import { liveProviders, type Providers } from "./providers.ts";
import { normalizePractice, syncTimes } from "../../../shared/bhc.ts";
import { check, enqueue, query, service } from "./runtime.ts";
export { bhcGet, list } from "./bhc-client.ts";
import { bhcGet, list } from "./bhc-client.ts";
import { validateBHCConnection, recordBHCFailure } from "./bhc-connection.ts";
import { saveLineup } from "./lineups.ts";
export async function syncBHC(
  uid: string,
  initial = false,
  afterId = 0,
  providers: Providers = liveProviders,
  expectedRevision?: number,
) {
  const connection = await query("connection_get", { user_id: uid });
  if (!connection.user_id || connection.access_state !== "active") return;
  if (
    expectedRevision !== undefined &&
    connection.revision !== expectedRevision
  )
    return;
  const lock = await query("sync_lock", {
    user_id: uid,
    revision: connection.revision,
  });
  if (!lock.acquired) return;
  const started = Date.now();
  try {
    const token = await validateBHCConnection(connection, providers);
    const club = connection.club_id;
    const args = { whitelabel_id: club, custid: connection.custid };
    const upcoming = list(
      await bhcGet(
        "practices/getAthletePractices",
        token,
        {
          ...args,
          upcoming: true,
        },
        providers,
      ),
    );
    // Include recent practices on every sync so the post-practice lineup refresh can still find them.
    const past = list(
      await bhcGet(
        "practices/getAthletePractices",
        token,
        {
          ...args,
          upcoming: false,
        },
        providers,
      ),
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
      await bhcGet(
        "equipment/getAllBoats",
        token,
        { whitelabel_id: club },
        providers,
      ),
    );
    const db = service();
    for (const meta of remaining) {
      if (completed >= 12 || Date.now() - started > 50000) {
        await enqueue(
          "bhc_sync",
          uid,
          null,
          new Date(),
          `bhc-continuation:${uid}:${connection.revision}:${cursor}:${Math.floor(Date.now() / 300000)}`,
          { initial, after_id: cursor, revision: connection.revision },
        );
        return;
      }
      const detailRaw = await bhcGet(
        "practices/getPractices",
        token,
        {
          ...args,
          practice_id: Number(meta.practice_id),
          meta_only: "No",
          upcoming: false,
        },
        providers,
      );
      const detail = Array.isArray(detailRaw) ? detailRaw[0] || {} : detailRaw;
      const p = normalizePractice(meta, detail, connection.custid, boats);
      const outingId = check(
        await db.rpc("apply_bhc_practice", {
          uid,
          revision: connection.revision,
          practice: {
            bhc_club_id: club,
            bhc_practice_id: p.bhc_practice_id,
            title: p.title,
            starts_at: p.starts_at,
            ends_at: p.ends_at,
            planned_coaches: p.planned_coaches,
            planned_boats: p.planned_boats,
          },
          member: {
            attendance: p.attendance,
            deadline: p.deadline,
            planned_boat: p.planned_boat,
            planned_seat: p.planned_seat,
          },
        }),
      );
      if (!outingId) return;
      await saveLineup(
        uid,
        connection.revision,
        outingId,
        meta,
        detail,
        connection.custid,
        boats,
        !initial,
      );
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
    await query("connection_synced", {
      user_id: uid,
      revision: connection.revision,
      error: null,
    });
  } catch (error) {
    await recordBHCFailure(connection, error, providers);
    const current = await query("connection_get", { user_id: uid });
    if (current.access_state !== "active") return;
    throw new Error("BHC sync failed.");
  } finally {
    await query("sync_unlock", { user_id: uid, revision: connection.revision });
  }
}
