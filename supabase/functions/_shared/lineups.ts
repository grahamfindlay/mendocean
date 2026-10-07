import { normalizePractice } from "../../../shared/bhc.ts";
import {
  normalizeLineup,
  lineupSignatures,
  lineupChange,
  lineupEmail,
  type Lineup,
} from "../../../shared/lineups.ts";
import { bhcGet, list } from "./bhc-client.ts";
import { validateBHCConnection, recordBHCFailure } from "./bhc-connection.ts";
import { check, query, service, env } from "./runtime.ts";
import { liveProviders, type Providers } from "./providers.ts";

// Enable only after ordinary-member visibility and post-publication edits are verified.
export const lineupsEnabled = () =>
  Deno.env.get("BHC_LINEUPS_ENABLED") === "true";
export async function saveLineup(
  uid: string,
  revision: number,
  outing: string,
  meta: Record<string, any>,
  detail: Record<string, any> | null,
  athlete: number,
  boats: Record<string, any>[],
  notify: boolean,
) {
  if (!lineupsEnabled()) return;
  const snapshot = normalizeLineup(meta, detail, athlete, boats);
  const previous = check(
    await service().rpc("lineup_previous", { uid, outing, revision }),
  ) as Lineup | null;
  const signatures = lineupSignatures(snapshot);
  check(
    await service().rpc("lineup_save", {
      uid,
      revision,
      outing,
      snapshot,
      assignment: signatures.assignment,
      crew: signatures.crew,
      summary: lineupChange(previous, snapshot),
      notify,
    }),
  );
  await query("lineup_checked", { user_id: uid, revision });
}
export async function pollLineups(
  uid: string,
  expectedRevision: number,
  providers: Providers = liveProviders,
) {
  if (!lineupsEnabled()) return;
  const connection = await query("connection_get", { user_id: uid });
  if (
    !connection.user_id ||
    connection.revision !== expectedRevision ||
    connection.access_state !== "active"
  )
    return;
  if (
    !(await query("sync_lock", { user_id: uid, revision: expectedRevision }))
      .acquired
  )
    throw new Error("BHC connection is busy");
  try {
    const token = await validateBHCConnection(connection, providers);
    const args = {
      whitelabel_id: connection.club_id,
      custid: connection.custid,
    };
    const metas = list(
      await bhcGet(
        "practices/getAthletePractices",
        token,
        { ...args, upcoming: true },
        providers,
      ),
    );
    const now = providers.now();
    const targets = metas.filter(
      (p) =>
        Number(p.start_time) * 1000 + 30 * 60000 > now &&
        (Number(p.attendance_window_end) * 1000 ||
          Number(p.start_time) * 1000 - 86400000) <= now,
    );
    const boats = targets.some((p) => p.lineups_set === "Yes")
      ? list(
          await bhcGet(
            "equipment/getAllBoats",
            token,
            { whitelabel_id: connection.club_id },
            providers,
          ),
        )
      : [];
    const started = Date.now();
    for (const meta of targets) {
      if (Date.now() - started > 30000)
        throw new Error("Lineup poll needs continuation");
      if (!["Yes", "No"].includes(meta.lineups_set))
        throw new Error("Unverified lineup publication state");
      let detail: Record<string, any> | null = null;
      if (meta.lineups_set === "Yes") {
        const raw = await bhcGet(
          "practices/getPractices",
          token,
          {
            ...args,
            practice_id: Number(meta.practice_id),
            meta_only: "No",
            upcoming: true,
          },
          providers,
        );
        detail = Array.isArray(raw) ? raw[0] : raw;
      }
      // A fresh attendance decision invalidates access and pending alerts too.
      const p = normalizePractice(meta, detail ?? {}, connection.custid, boats);
      const outing = check(
        await service().rpc("apply_bhc_practice", {
          uid,
          revision: expectedRevision,
          practice: {
            bhc_club_id: connection.club_id,
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
      if (!outing) return;
      await saveLineup(
        uid,
        expectedRevision,
        outing,
        meta,
        detail,
        connection.custid,
        boats,
        true,
      );
    }
  } catch (error) {
    await recordBHCFailure(connection, error, providers, "lineup");
    throw new Error("Lineup poll failed");
  } finally {
    await query("sync_unlock", { user_id: uid, revision: expectedRevision });
  }
}
export async function sendLineup(
  event: string,
  channel: "email" | "push",
  providers: Providers = liveProviders,
) {
  if (!lineupsEnabled()) return;
  const db = service();
  const reserved = check(
    await db.rpc("lineup_reserve", { event, target_channel: channel }),
  );
  if (!reserved.allowed) {
    if (reserved.retry) throw new Error("Lineup delivery needs retry");
    return;
  }
  const { token, key } = reserved;
  const current = reserved.event;
  const snapshot: Lineup = current.snapshot;
  const url = env("APP_URL") + "/?tab=Lineups&lineup=" + current.outing_id;
  const title =
    current.kind === "published"
      ? "Your lineup is published"
      : "Your lineup has changed";
  const active = async (endpoint: string | null = null) =>
    check(
      await db.rpc("lineup_delivery_active", {
        event,
        target_channel: channel,
        token,
        target_endpoint: endpoint,
      }),
    );
  let failure: string | null = null;
  try {
    if (!(await active())) {
      failure = "cancelled";
      return;
    }
    if (channel === "email") {
      let message = reserved.payload;
      if (!message) {
        const user = await db.auth.admin.getUserById(current.user_id);
        if (user.error || !user.data.user.email)
          throw new Error("Email unavailable");
        message = check(
          await db.rpc("lineup_prepare_email", {
            event,
            token,
            message: {
              from: env("EMAIL_FROM"),
              to: [user.data.user.email],
              subject: title,
              ...lineupEmail(
                snapshot,
                current.summary,
                url,
                env("APP_URL") + "/?account=1",
              ),
            },
          }),
        );
      }
      if (!message || !(await active())) {
        failure = "cancelled";
        return;
      }
      const response = await providers.fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${env("RESEND_API_KEY")}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify(message),
      });
      if (!response.ok) throw new Error("Email rejected");
    } else {
      let sent = reserved.devices.length;
      const deadline = Date.now() + 30000;
      for (const subscription of await query("push_get", {
        user_id: current.user_id,
      })) {
        if (reserved.devices.includes(subscription.endpoint)) continue;
        if (Date.now() > deadline) {
          failure = "provider_failed";
          break;
        }
        if (!(await active(subscription.endpoint))) {
          failure = "cancelled";
          break;
        }
        try {
          await providers.push(
            subscription,
            JSON.stringify({
              title,
              body: current.summary,
              url,
              tag: `lineup-${current.outing_id}`,
            }),
            {
              TTL: Math.max(
                0,
                Math.floor(
                  (Date.parse(snapshot.starts_at) +
                    30 * 60000 -
                    providers.now()) /
                    1000,
                ),
              ),
              timeout: 10000,
            },
          );
          check(
            await db.rpc("lineup_finish_device", {
              event,
              token,
              target_endpoint: subscription.endpoint,
            }),
          );
          sent++;
        } catch (error) {
          if (
            [404, 410].includes(
              (error as { statusCode?: number }).statusCode ?? 0,
            )
          )
            await query("push_delete", { endpoint: subscription.endpoint });
          else failure = "provider_failed";
        }
      }
      if (!sent && !failure) failure = "no_device";
    }
  } catch {
    failure = "provider_failed";
  } finally {
    check(
      await db.rpc("lineup_finish", {
        event,
        target_channel: channel,
        token,
        failure,
      }),
    );
  }
  if (failure && failure !== "cancelled")
    throw new Error("Lineup delivery needs retry");
}
