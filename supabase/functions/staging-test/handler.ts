import {
  body,
  check,
  env,
  hash,
  json,
  service,
  userClient,
  query,
} from "../_shared/runtime.ts";
import { saveLineup, sendLineup } from "../_shared/lineups.ts";
import { collectWeather } from "../_shared/weather.ts";
import { liveProviders, type Providers } from "../_shared/providers.ts";
import { scenarios, scenarioAttendance } from "./scenarios.ts";
import type { Lineup } from "../../../shared/lineups.ts";
export function createStagingHandler(providers: Providers = liveProviders) {
  return async (req: Request): Promise<Response> => {
    try {
      if (
        Deno.env.get("STAGING_MODE") !== "true" ||
        Deno.env.get("SUPABASE_URL") !== Deno.env.get("STAGING_EXPECTED_URL")
      )
        return json(req, { error: "Unavailable" }, 404);
      if (req.method === "OPTIONS") return json(req, {});
      if (req.method !== "POST")
        return json(req, { error: "Method not allowed" }, 405);
      const input = await body(req, 1024),
        authorization = req.headers.get("authorization") || "";
      const dispatcher =
        (await hash(authorization)) ===
        (await hash("Bearer " + env("STAGING_TEST_SECRET")));
      if (dispatcher && input.action === "tick") {
        const jobs = check(await service().rpc("staging_claim"));
        let sent = 0,
          failed = 0;
        for (const j of jobs) {
          try {
            await sendLineup(j.payload.event_id, j.payload.channel, providers);
            await query("job_finish", { id: j.id, status: "done" });
            sent++;
          } catch {
            await query("job_finish", {
              id: j.id,
              status: j.attempts >= 5 ? "failed" : "pending",
              error: "Staging delivery retry",
              due_at: new Date(Date.now() + 60000).toISOString(),
            });
            failed++;
          }
        }
        return json(req, { sent, failed });
      }
      if (dispatcher && input.action === "weather") {
        await collectWeather(providers);
        return json(req, { weather: true });
      }
      let uid: string | undefined;
      if (dispatcher) uid = env("STAGING_OWNER_ID");
      else {
        const { data, error } = await userClient(authorization).auth.getUser();
        if (error || !data.user)
          return json(req, { error: "Sign in required" }, 401);
        uid = data.user.id;
      }
      if (uid !== env("STAGING_OWNER_ID"))
        return json(req, { error: "Staging owner required" }, 403);
      if (!scenarios.includes(input.action))
        return json(req, { error: "Unknown test action" }, 400);
      const c = check(await service().rpc("staging_fixture", { uid }));
      try {
        const previous = check(
          await service().rpc("lineup_previous", {
            uid,
            outing: c.outing,
            revision: c.revision,
          }),
        ) as Lineup | null;
        let people;
        try {
          people = scenarioAttendance(input.action, c.athlete, previous);
        } catch (error) {
          return json(req, { error: (error as Error).message }, 409);
        }
        const meta = {
          name: c.title,
          start_time: Date.parse(c.starts_at) / 1000,
          end_time: Date.parse(c.ends_at) / 1000,
          location_name: "Test boathouse",
          lineups_set: input.action === "reset" ? "No" : "Yes",
        };
        const detail = {
          lineups_set: meta.lineups_set,
          location: { name: "Test boathouse" },
          session_plan: {
            session_plan: "Fictional crew for notification-link testing.",
          },
          attendance: people,
          assigned_coaches: [
            {
              boat_id: 920000001,
              custid: 930000001,
              fname: "Sam",
              lname: "Test",
            },
          ],
        };
        await saveLineup(
          uid,
          c.revision,
          c.outing,
          meta,
          detail,
          c.athlete,
          [
            {
              boat_id: 920000001,
              boat_name: "TEST · River",
              boat_type: 4,
              coxed: "Yes",
              rigging: "sweep",
            },
          ],
          input.action !== "reset",
        );
        const scheduled = check(await service().rpc("staging_delay", { uid }));
        return json(req, {
          outing_id: c.outing,
          scheduled,
          message: scheduled
            ? "Test notifications queued. Close the app; delivery starts in 30 seconds and may take another minute."
            : "Lineup updated. Enable and save lineup email/push preferences to receive notifications.",
        });
      } finally {
        await query("sync_unlock", { user_id: uid, revision: c.revision });
      }
    } catch {
      return json(req, { error: "Staging test could not complete" }, 500);
    }
  };
}
