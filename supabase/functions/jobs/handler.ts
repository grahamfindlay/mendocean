import { liveProviders, type Providers } from "../_shared/providers.ts";
import {
  body,
  check,
  enqueue,
  env,
  hash,
  json,
  query,
  service,
} from "../_shared/runtime.ts";
import {
  collectWeather,
  enrichOuting,
  WeatherCollectionError,
} from "../_shared/weather.ts";
import { syncBHC } from "../_shared/bhc.ts";
import { sendReminder } from "../_shared/notifications.ts";
import { localDateTime } from "../../../shared/domain.ts";
import {
  observeFailure,
  optionalMonitoring,
} from "../_shared/observability.ts";
import { ownerDigest } from "../_shared/owner-digest.ts";
export function createJobsHandler(
  providers: Providers = liveProviders,
  elapsed: () => number = () => performance.now(),
) {
  return async (req: Request): Promise<Response> => {
    try {
      const digestSecret = Deno.env.get("OWNER_DIGEST_SECRET");
      if (
        req.method === "POST" &&
        digestSecret &&
        (await hash(req.headers.get("authorization") || "")) ===
          (await hash(`Bearer ${digestSecret}`))
      ) {
        const input = await body(req, 2048);
        if (
          input.action !== "owner-digest" ||
          typeof input.preview !== "boolean" ||
          Object.keys(input).some((k) => !["action", "preview"].includes(k))
        )
          return json(req, { error: "Invalid digest request" }, 400);
        return json(req, await ownerDigest(input.preview, providers));
      }
      if (
        req.method !== "POST" ||
        (await hash(req.headers.get("authorization") || "")) !==
          (await hash("Bearer " + env("JOBS_SECRET")))
      )
        return json(req, { error: "Unauthorized" }, 401);
      const input = await body(req, 2000000);
      if (input.action === "training-data")
        return json(req, await query("training_snapshot"));
      if (input.action === "model-shadow") {
        if (
          !input.artifact ||
          typeof input.artifact !== "object" ||
          !input.metrics
        )
          return json(req, { error: "Invalid model" }, 400);
        return json(
          req,
          await query("model_shadow", {
            family: "weather-v1",
            artifact: input.artifact,
            metrics: input.metrics,
          }),
        );
      }
      if (input.action !== "tick")
        return json(req, { error: "Unknown action" }, 400);
      const started = elapsed();
      const now = new Date(providers.now());
      await optionalMonitoring("tick_started", { at: now.toISOString() });
      const stamp = Math.floor(now.getTime() / 900000);
      await enqueue("weather", null, null, now, `weather:15m:${stamp}`);
      const local = localDateTime(now.toISOString());
      if (local.slice(11, 13) === "16")
        for (const c of await query("connections"))
          await enqueue(
            "bhc_sync",
            c.user_id,
            null,
            now,
            `daily:${c.user_id}:${local.slice(0, 10)}`,
          );
      const jobs = await query("claim");
      const results = [];
      for (const [index, job] of jobs.entries()) {
        const jobStarted = performance.now();
        if (elapsed() - started > 45000) {
          check(
            await service().rpc("release_claims", {
              ids: jobs.slice(index).map((j: { id: number }) => j.id),
            }),
          );
          break;
        }
        try {
          if (job.kind === "weather") await collectWeather(providers);
          else if (job.kind === "bhc_sync") {
            const result = await syncBHC(
              job.user_id,
              job.payload?.initial,
              job.payload?.after_id || 0,
              providers,
              job.payload?.revision,
              job.payload?.run_id || String(job.id),
            );
            if (result === "busy") {
              await query("job_finish", {
                id: job.id,
                status: "pending",
                due_at: new Date(Date.now() + 15000).toISOString(),
              });
              results.push({ id: job.id, status: "deferred" });
              continue;
            }
          } else if (job.kind === "reminder")
            await sendReminder(
              job.user_id,
              job.outing_id,
              job.payload?.generation || 0,
              providers,
            );
          else if (job.kind === "enrich")
            await enrichOuting(job.outing_id, providers);
          else throw new Error("Unknown job type");
          await query("job_finish", { id: job.id, status: "done" });
          console.info(
            JSON.stringify({
              severity: "info",
              operation: job.kind,
              stage: "complete",
              job_id: job.id,
              user_id: job.user_id,
              outcome: "done",
              duration_ms: Math.round(performance.now() - jobStarted),
            }),
          );
          results.push({ id: job.id, status: "done" });
        } catch (error) {
          const retry = job.attempts < 5;
          await query("job_finish", {
            id: job.id,
            status: retry ? "pending" : "failed",
            error:
              error instanceof WeatherCollectionError
                ? error.message
                : "Task failed; no credentials or personal data were logged.",
            due_at: new Date(
              Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts),
            ).toISOString(),
          });
          results.push({ id: job.id, status: retry ? "retry" : "failed" });
          console.error(
            JSON.stringify({
              severity: retry ? "warning" : "error",
              operation: job.kind,
              stage:
                error instanceof WeatherCollectionError ? error.stage : "run",
              job_id: job.id,
              user_id: job.user_id,
              outcome: retry ? "retry" : "failed",
              duration_ms: Math.round(performance.now() - jobStarted),
            }),
          );
        }
      }
      await optionalMonitoring("tick_completed", {
        at: new Date(providers.now()).toISOString(),
      });
      return json(req, { results });
    } catch {
      await observeFailure("dispatcher", crypto.randomUUID(), null, 0);
      return json(req, { error: "Job dispatch failed." }, 500);
    }
  };
}
