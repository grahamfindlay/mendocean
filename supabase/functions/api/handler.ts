import { canLog } from "../../../shared/presentation.ts";
import {
  DEFAULT_WEEK_PERIODS,
  legacyPeriods,
  weekPeriodsSchema,
} from "../../../shared/weekPeriods.ts";
import { liveProviders, type Providers } from "../_shared/providers.ts";
import { z } from "zod";
import { sendTestPush } from "../_shared/notifications.ts";
import { outingSchema, reportSchema } from "../../../shared/domain.ts";
import {
  HttpError,
  body,
  check,
  cors,
  enqueue,
  env,
  hash,
  json,
  query,
  scheduleReminder,
  service,
  userClient,
} from "../_shared/runtime.ts";
import { connectBHC, passwordBHCEnabled } from "../_shared/bhc-connection.ts";
import { bhcStatus } from "../../../shared/bhcConnection.ts";
import { lineupsEnabled } from "../_shared/lineups.ts";
import { manageAttendance } from "../_shared/attendance.ts";
import { assess, assessmentCapabilities } from "../../../shared/model.ts";
import {
  reminderBlock,
  reminderBlockMessage,
  reminderChannels,
} from "../../../shared/reminders.ts";
import { weatherFeatures } from "../_shared/weather.ts";
import { monitoring, observeFailure } from "../_shared/observability.ts";
import {
  readiness,
  type ActivitySummary,
  type Operations,
} from "../../../shared/monitoring.ts";
const uuid = z.string().uuid();
export function createApiHandler(providers: Providers = liveProviders) {
  return async (req: Request): Promise<Response> => {
    const headers = new Headers(req.headers);
    const supplied = headers.get("x-request-id") || "";
    const requestId = uuid.safeParse(supplied).success
      ? supplied
      : crypto.randomUUID();
    headers.set("x-request-id", requestId);
    req = new Request(req, { headers });
    const started = performance.now();
    let actor: string | null = null;
    const path = new URL(req.url).pathname.split("/api/")[1] || "";
    if (req.method === "OPTIONS")
      return new Response(null, { headers: cors(req) });
    try {
      if (path === "monitor/ready") {
        const secret = Deno.env.get("MONITOR_SECRET");
        if (
          !secret ||
          (await hash(req.headers.get("authorization") || "")) !==
            (await hash(`Bearer ${secret}`))
        )
          return json(req, { error: "Unauthorized" }, 401);
        if (req.method !== "GET")
          return json(req, { error: "Method not allowed" }, 405);
        try {
          const result = readiness(
            (await monitoring("operations", {
              at: new Date(providers.now()).toISOString(),
            })) as Operations,
            providers.now(),
          );
          return json(req, result, result.status === "ready" ? 200 : 503);
        } catch {
          return json(
            req,
            { status: "unhealthy", reasons: ["database_unavailable"] },
            503,
          );
        }
      }
      const db = service();
      if (path === "weather" && req.method === "GET") {
        const run = check(
          await db
            .from("weather_runs")
            .select("summary")
            .order("fetched_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        );
        if (!run)
          throw new HttpError(
            503,
            "The first weather forecast has not arrived yet.",
          );
        return json(req, run.summary);
      }
      if (path === "assessment/capabilities" && req.method === "GET") {
        const { data } = await userClient(
          req.headers.get("authorization") || "",
        ).auth.getUser();
        return json(
          req,
          assessmentCapabilities(
            await query("model_active"),
            data.user?.id || null,
          ),
        );
      }
      if (path === "assessment" && req.method === "POST") {
        const input = z
          .object({
            time: z.string().datetime(),
            basis: z.enum(["pooled", "mine"]),
            route: z.enum(["either", "east", "west"]),
            boat: z.string().max(8),
            coach: z.string().max(100),
          })
          .parse(await body(req));
        let userId: string | null = null;
        if (input.basis === "mine") {
          const { data, error } = await userClient(
            req.headers.get("authorization") || "",
          ).auth.getUser();
          if (error || !data.user)
            throw new HttpError(401, "Sign in to use only your observations.");
          userId = data.user.id;
        }
        const run = check(
          await db
            .from("weather_runs")
            .select("summary,fetched_at")
            .order("fetched_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        );
        const f = run?.summary?.hours
          ? weatherFeatures(run.summary.hours, input.time)
          : null;
        if (!f || Date.now() - Date.parse(run!.fetched_at) > 6 * 3600000)
          throw new HttpError(
            503,
            "Fresh weather is not available for that time.",
          );
        return json(
          req,
          assess(await query("model_active"), f, userId, input.basis, input),
        );
      }
      const authorization = req.headers.get("authorization") || "";
      const client = userClient(authorization);
      const {
        data: { user },
        error: authError,
      } = await client.auth.getUser();
      if (authError || !user)
        throw new HttpError(401, "Please sign in to continue.");
      const uid = user.id;
      actor = uid;
      const profile = check(
        await client.from("profiles").select("*").eq("id", uid).single(),
      );
      if (!profile?.approved)
        throw new HttpError(403, "An invitation is required.");
      const member = async (id: string) => {
        const m = check(
          await client
            .from("outing_members")
            .select("*")
            .eq("outing_id", id)
            .eq("user_id", uid)
            .maybeSingle(),
        );
        if (!m) throw new HttpError(404, "Outing not found.");
        return m;
      };
      const ownOutings = async () => {
        const [or, mr, rr, states] = await Promise.all([
          client
            .from("outings")
            .select("*")
            .order("starts_at", { ascending: false }),
          client.from("outing_members").select("*"),
          client.from("reports").select("*"),
          db.rpc("reminder_states", { uid }),
        ]);
        const members = check(mr) || [];
        const reports = check(rr) || [];
        const reminderStates = check(states) || [];
        return (check(or) || []).map((o) => {
          const m = members.find((m) => m.outing_id === o.id);
          return {
            ...o,
            attendance: m?.attendance,
            attendance_deadline: m?.deadline || null,
            reminder: m?.reminder,
            skipped: m?.skipped,
            reminder_state:
              reminderStates.find(
                (s: { outing_id: string }) => s.outing_id === o.id,
              ) || null,
            planned_boat: m?.planned_boat || o.planned_boat,
            reports: reports
              .filter((r) => r.outing_id === o.id)
              .map((r) => ({
                ...r.data,
                id: r.id,
                outing_id: r.outing_id,
                user_id: r.user_id,
                version: r.version,
                created_at: r.created_at,
              })),
          };
        });
      };
      if (
        (path === "week-periods" || path === "week-periods/v2") &&
        req.method === "GET"
      ) {
        const periods = weekPeriodsSchema.parse(
          profile.week_periods ?? DEFAULT_WEEK_PERIODS,
        );
        return json(req, {
          periods: path === "week-periods" ? legacyPeriods(periods) : periods,
        });
      }
      if (path === "account" && req.method === "GET") {
        const connection = await query("connection_get", { user_id: uid });
        if (
          connection.user_id &&
          connection.access_state === "active" &&
          (!connection.last_attempt_at ||
            Date.now() - Date.parse(connection.last_attempt_at) > 15 * 60000)
        )
          await enqueue(
            "bhc_sync",
            uid,
            null,
            new Date(),
            `bhc:${uid}:${Math.floor(Date.now() / 900000)}`,
          );
        const outings = await ownOutings();
        return json(req, {
          profile,
          push_devices: (await query("push_get", { user_id: uid })).length,
          outings,
          lineups: lineupsEnabled()
            ? check(await db.rpc("lineups_get", { uid }))
            : [],
          lineups_enabled: lineupsEnabled(),
          coaches: check(
            await client.from("coaches").select("id,name").order("name"),
          ),
          bhc: {
            ...bhcStatus(connection, providers.now(), passwordBHCEnabled()),
            upcoming_practices: outings.filter(
              (o) =>
                o.kind === "official" &&
                o.bhc_club_id === connection.club_id &&
                Date.parse(o.ends_at) > providers.now(),
            ).length,
          },
        });
      }
      if (path === "health" && req.method === "GET") {
        if (profile.role !== "admin")
          throw new HttpError(403, "Administrator access required.");
        return json(req, check(await db.rpc("pilot_health")));
      }
      if (
        path === "admin/activity" ||
        path === "admin/operations" ||
        path === "admin/timeline"
      ) {
        if (profile.role !== "admin")
          throw new HttpError(403, "Administrator access required.");
        if (req.method !== "GET")
          throw new HttpError(405, "Method not allowed.");
        const params = new URL(req.url).searchParams;
        const args =
          path === "admin/timeline"
            ? {
                user_id: uuid.parse(params.get("user")),
                before: params.get("before")
                  ? z.coerce
                      .number()
                      .int()
                      .positive()
                      .parse(params.get("before"))
                  : undefined,
              }
            : {
                days: z.coerce
                  .number()
                  .int()
                  .min(1)
                  .max(30)
                  .parse(params.get("days") || 7),
              };
        const result = await monitoring(
          path === "admin/timeline"
            ? "timeline"
            : path === "admin/activity"
              ? "activity"
              : "operations",
          args,
        );
        if (path === "admin/activity") {
          const activity = result as ActivitySummary;
          const identities = check(
            await db.rpc("admin_account_emails", {
              user_ids: activity.users.map((user) => user.id),
            }),
          ) as { id: string; email: string | null }[];
          const emails = new Map(
            identities.map((user) => [user.id, user.email]),
          );
          activity.users = activity.users.map((user) => ({
            ...user,
            email: emails.get(user.id) || null,
          }));
        }
        return json(req, result);
      }
      if (path === "admin/outings" && req.method === "GET") {
        if (profile.role !== "admin")
          throw new HttpError(403, "Administrator access required.");
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(1_000_000)
          .parse(new URL(req.url).searchParams.get("offset") ?? 0);
        return json(
          req,
          check(
            await db
              .from("outings")
              .select(
                "id,title,kind,starts_at,ends_at,actual_starts_at,actual_ends_at",
              )
              .order("starts_at", { ascending: false })
              .order("id", { ascending: false })
              .range(offset, offset + 199),
          ),
        );
      }
      if (path === "export" && req.method === "GET")
        return json(req, {
          exported_at: new Date().toISOString(),
          profile,
          push_devices: (await query("push_get", { user_id: uid })).length,
          outings: await ownOutings(),
        });
      if (req.method !== "POST")
        throw new HttpError(405, "Method not allowed.");
      const input = await body(
        req,
        path === "bhc/connect-password" ? 4096 : 32768,
      );
      if (path === "activity/observe") {
        z.object({}).strict().parse(input);
        await monitoring("observe", { user_id: uid });
        return json(req, { observed: true });
      }
      if (path === "bhc/attendance") {
        const parsed = z
          .object({
            outing_id: uuid,
            change: z
              .object({
                attendance: z.enum(["attending", "declined"]),
                expected: z.enum(["attending", "declined", "unknown"]),
                request_id: uuid,
              })
              .strict()
              .optional(),
          })
          .strict()
          .parse(input);
        await member(parsed.outing_id);
        return json(
          req,
          await manageAttendance(
            uid,
            parsed.outing_id,
            parsed.change,
            providers,
          ),
        );
      }
      if (path === "outing") {
        const outing = outingSchema.parse(input);
        if (outing.kind !== "independent")
          throw new HttpError(400, "Use BHC to import an official practice.");
        const saved = check(
          await client.rpc("create_outing", { body: outing }),
        );
        if (outing.reminder) await scheduleReminder(uid, saved);
        return json(req, saved);
      }
      if (path === "report") {
        const outing = outingSchema.parse(input.outing);
        const report = reportSchema.parse(input.report);
        if (
          !canLog(
            { starts_at: report.actual_start || outing.starts_at },
            Date.now(),
          )
        )
          throw new HttpError(
            400,
            "Logging opens 15 minutes before the row starts.",
          );
        if (outing.kind === "independent") {
          const m = check(
            await client
              .from("outing_members")
              .select("outing_id")
              .eq("outing_id", outing.id)
              .eq("user_id", uid)
              .maybeSingle(),
          );
          if (!m) check(await client.rpc("create_outing", { body: outing }));
        }
        await member(outing.id);
        const { data, error } = await client.rpc("save_report", {
          target: outing.id,
          body: report,
        });
        if (error)
          throw new HttpError(
            error.code === "40001" ? 409 : 400,
            error.code === "40001"
              ? "This report changed elsewhere. Reload it before editing."
              : "Report could not be saved. Check the details and try again.",
          );
        await enqueue(
          "enrich",
          null,
          outing.id,
          new Date(),
          `enrich:${outing.id}:${data.version}`,
        );
        return json(req, data);
      }
      if (path === "report/delete") {
        const parsed = z
          .object({ id: uuid, version: z.number().int().positive() })
          .parse(input);
        const { error } = await client.rpc("delete_report", {
          target: parsed.id,
          expected: parsed.version,
        });
        if (error)
          throw new HttpError(
            409,
            "Report unavailable or changed. Reload before deleting.",
          );
        return json(req, { deleted: true });
      }
      if (path === "week-periods" || path === "week-periods/v2") {
        let { periods } = z
          .object({ periods: weekPeriodsSchema })
          .strict()
          .parse(input);
        if (path === "week-periods") {
          // Old clients do not know weekday restrictions; their edits must retain them.
          const previous = weekPeriodsSchema.parse(
            profile.week_periods ?? DEFAULT_WEEK_PERIODS,
          );
          periods = periods.map((period) => ({
            ...period,
            days: previous.find((p) => p.id === period.id)?.days ?? period.days,
          }));
        }
        check(
          await db
            .from("profiles")
            .update({ week_periods: periods })
            .eq("id", uid),
        );
        return json(req, {
          periods: path === "week-periods" ? legacyPeriods(periods) : periods,
        });
      }
      if (path === "lineups/refresh") {
        if (!lineupsEnabled())
          throw new HttpError(
            503,
            "Lineups are awaiting connection verification.",
          );
        const connection = await query("connection_get", { user_id: uid });
        if (!connection.user_id || connection.access_state !== "active")
          throw new HttpError(
            409,
            "Reconnect Boathouse Connect to check lineups.",
            "bhc_reconnect_required",
          );
        await enqueue(
          "lineup_poll",
          uid,
          null,
          new Date(),
          `lineup-manual:${uid}:${connection.revision}:${Math.floor(providers.now() / 60000)}`,
          { revision: connection.revision },
        );
        return json(req, { queued: true });
      }
      if (path === "settings") {
        const settings = z
          .object({
            display_name: z.string().trim().max(100),
            reminder_channel: z.enum(["none", "email", "push"]).optional(),
            reminder_channels: z
              .array(z.enum(["email", "push"]))
              .max(2)
              .optional(),
            reminders_paused: z.boolean(),
            lineup_channels: z
              .array(z.enum(["email", "push"]))
              .max(2)
              .optional(),
            lineup_changes: z.enum(["crew", "assignment"]).optional(),
          })
          .refine(
            (v) =>
              (v.reminder_channels !== undefined) !==
              (v.reminder_channel !== undefined),
            "Choose reminder channels.",
          )
          .parse(input);
        check(await db.from("profiles").update(settings).eq("id", uid));
        if (
          profile.reminders_paused !== settings.reminders_paused ||
          reminderChannels(profile).sort().join() !==
            reminderChannels(settings).sort().join()
        )
          check(await db.rpc("refresh_reminder_jobs", { uid }));
        return json(req, { saved: true });
      }
      if (path === "share") {
        const id = uuid.parse(input.outing_id);
        await member(id);
        const outing = check(
          await client
            .from("outings")
            .select("owner_id,kind")
            .eq("id", id)
            .single(),
        );
        if (!outing || outing.owner_id !== uid || outing.kind !== "independent")
          throw new HttpError(
            403,
            "Only the owner may share this independent outing.",
          );
        const token = crypto.randomUUID() + crypto.randomUUID();
        await query("link_put", { hash: await hash(token), outing_id: id });
        return json(req, { url: env("APP_URL") + "/?join=" + token });
      }
      if (path === "join") {
        const token = z.string().min(60).max(100).parse(input.token);
        const link = await query("link_get", { hash: await hash(token) });
        if (!link.outing_id)
          throw new HttpError(404, "This invitation is invalid or expired.");
        check(
          await db.from("outing_members").upsert(
            {
              outing_id: link.outing_id,
              user_id: uid,
              attendance: "attending",
            },
            { onConflict: "outing_id,user_id", ignoreDuplicates: true },
          ),
        );
        return json(req, { joined: true });
      }
      if (path === "reminder") {
        const parsed = z
          .object({
            outing_id: uuid,
            action: z.enum(["skip", "enable", "snooze"]),
          })
          .parse(input);
        const membership = await member(parsed.outing_id);
        const outing = check(
          await client
            .from("outings")
            .select("id,ends_at")
            .eq("id", parsed.outing_id)
            .single(),
        );
        if (!outing) throw new HttpError(404, "Outing not found.");
        if (parsed.action !== "skip") {
          const reports = check(
            await client
              .from("reports")
              .select("id")
              .eq("outing_id", outing.id)
              .eq("user_id", uid),
          );
          const reason = reminderBlock(
            {
              ...outing,
              attendance: membership.attendance,
              reports: reports || [],
            },
            profile,
            parsed.action,
            providers.now(),
          );
          if (reason) throw new HttpError(409, reminderBlockMessage(reason));
          const states = check(await db.rpc("reminder_states", { uid }));
          if (
            parsed.action === "enable" &&
            states?.find(
              (s: { outing_id: string; sent_at: string | null }) =>
                s.outing_id === outing.id,
            )?.sent_at
          )
            throw new HttpError(
              409,
              "A logging reminder was already sent. Choose a one-hour reminder to receive another.",
            );
        }
        check(
          await db
            .from("outing_members")
            .update({
              reminder: parsed.action !== "skip",
              skipped: parsed.action === "skip",
            })
            .eq("outing_id", parsed.outing_id)
            .eq("user_id", uid),
        );
        const generation = check(
          await db.rpc("reset_reminder", {
            uid,
            outing: outing.id,
            repeat: parsed.action === "snooze",
          }),
        );
        if (parsed.action !== "skip")
          await enqueue(
            "reminder",
            uid,
            outing.id,
            parsed.action === "snooze"
              ? new Date(providers.now() + 3600000)
              : new Date(
                  Math.max(
                    providers.now(),
                    Date.parse(outing.ends_at) + 900000,
                  ),
                ),
            `reminder:${uid}:${outing.id}:${Date.now()}`,
            { generation },
          );
        return json(req, { saved: true });
      }
      if (path === "push/test") {
        const endpoint = z.string().url().max(2048).parse(input.endpoint);
        await sendTestPush(uid, endpoint, providers);
        return json(req, { accepted: true });
      }
      if (path === "push/status") {
        const endpoint = z.string().url().max(2048).parse(input.endpoint);
        const subscriptions = await query("push_get", { user_id: uid });
        return json(req, {
          registered: subscriptions.some(
            (s: { endpoint: string }) => s.endpoint === endpoint,
          ),
        });
      }
      if (path === "push") {
        const subscription = z
          .object({
            endpoint: z.string().url().max(2048),
            keys: z.object({
              p256dh: z.string().max(200),
              auth: z.string().max(100),
            }),
          })
          .parse(input.subscription);
        const endpoint = new URL(subscription.endpoint);
        const allowed = [
          "fcm.googleapis.com",
          "updates.push.services.mozilla.com",
          "web.push.apple.com",
        ];
        if (
          endpoint.protocol !== "https:" ||
          !allowed.some(
            (h) =>
              endpoint.hostname === h || endpoint.hostname.endsWith("." + h),
          )
        )
          throw new HttpError(400, "Unsupported push service.");
        await query("push_put", { user_id: uid, subscription });
        check(await db.rpc("refresh_reminder_jobs", { uid }));
        return json(req, { saved: true });
      }
      if (path === "bhc/connect" || path === "bhc/connect-password") {
        const parsed =
          path === "bhc/connect"
            ? z
                .object({
                  token: z.string().trim().min(20).max(200),
                  club_id: z.number().int().positive().optional(),
                  request_id: uuid.optional(),
                })
                .strict()
                .parse(input)
            : z
                .object({
                  email: z.string().trim().email().max(254),
                  password: z.string().min(1).max(1024),
                  request_id: uuid.optional(),
                })
                .strict()
                .parse(input);
        return json(
          req,
          await connectBHC(
            uid,
            parsed.request_id || requestId,
            parsed,
            providers,
          ),
        );
      }
      if (path === "bhc/disconnect") {
        await query("connection_delete", { user_id: uid });
        return json(req, { disconnected: true });
      }
      if (path === "bhc/sync") {
        const connection = await query("connection_get", { user_id: uid });
        const status = bhcStatus(connection, providers.now());
        if (!status.connected)
          throw new HttpError(
            409,
            status.state === "membership_missing"
              ? "Check your Mendota membership in BHC."
              : "Reconnect Boathouse Connect to continue.",
            status.state === "membership_missing"
              ? "bhc_membership_missing"
              : "bhc_reconnect_required",
          );
        await enqueue(
          "bhc_sync",
          uid,
          null,
          new Date(),
          `bhc:${uid}:${Math.floor(Date.now() / 900000)}`,
        );
        return json(req, { queued: true });
      }
      if (path === "outings/reconcile") {
        if (profile.role !== "admin")
          throw new HttpError(403, "Administrator access required.");
        const ids = z.object({ source: uuid, target: uuid }).parse(input);
        const { data, error } = await db.rpc("reconcile_outings", {
          ...ids,
          actor: uid,
        });
        if (error) throw new HttpError(409, error.message);
        await enqueue(
          "enrich",
          null,
          ids.target,
          new Date(),
          `reconcile:${ids.target}:${Date.now()}`,
        );
        return json(req, data);
      }
      if (path === "outings/interval") {
        if (profile.role !== "admin")
          throw new HttpError(403, "Administrator access required.");
        const v = z
          .object({
            id: uuid,
            start: z.string().datetime(),
            end: z.string().datetime(),
          })
          .refine((v) => v.end > v.start, "End must be after start.")
          .parse(input);
        check(
          await db
            .from("outings")
            .update({ actual_starts_at: v.start, actual_ends_at: v.end })
            .eq("id", v.id),
        );
        await query("model_rollback");
        await enqueue(
          "enrich",
          null,
          v.id,
          new Date(),
          `interval:${v.id}:${Date.now()}`,
        );
        return json(req, { saved: true });
      }
      if (path === "models/publish" || path === "models/rollback") {
        if (profile.role !== "admin")
          throw new HttpError(403, "Administrator access required.");
        await query(
          path === "models/publish" ? "model_publish" : "model_rollback",
          {
            id: path === "models/publish" ? uuid.parse(input.id) : undefined,
            actor: uid,
          },
        );
        return json(req, { saved: true });
      }
      if (path === "invite") {
        if (profile.role !== "admin")
          throw new HttpError(403, "Administrator access required.");
        const email = z.string().email().parse(input.email);
        const { data: created, error } = await db.auth.admin.createUser({
          email,
          email_confirm: true,
        });
        if (error)
          throw new HttpError(
            400,
            "Unable to create account; it may already exist.",
          );
        check(
          await db
            .from("profiles")
            .update({ approved: true })
            .eq("id", created.user!.id),
        );
        await query("audit", { actor: uid, event: "user_invited" });
        return json(req, { created: true });
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      if (
        !(error instanceof z.ZodError) &&
        (!(error instanceof HttpError) || error.status >= 500)
      )
        await observeFailure(
          path,
          requestId,
          actor,
          performance.now() - started,
        );
      if (error instanceof z.ZodError)
        return json(
          req,
          {
            error:
              path === "bhc/connect-password"
                ? "Check your BHC email and password."
                : error.issues.map((i) => i.message).join(" "),
          },
          400,
        );
      return json(
        req,
        {
          ...(error instanceof HttpError && error.code
            ? { code: error.code }
            : {}),
          error:
            error instanceof HttpError
              ? error.message
              : "This request could not be completed. Please try again.",
        },
        error instanceof HttpError ? error.status : 500,
      );
    }
  };
}
