import { check, query, service } from "./runtime.ts";
import { syncBHC } from "./bhc.ts";
import type { Providers } from "./providers.ts";

export type BackgroundTask = (run: () => Promise<void>) => void;

// Supabase keeps this promise alive after the API response. Work is still
// claimed from the durable queue, so cron can recover interruption or failure.
export const edgeBackground: BackgroundTask = (run) => {
  const runtime = (
    globalThis as typeof globalThis & {
      EdgeRuntime: { waitUntil(task: Promise<void>): void };
    }
  ).EdgeRuntime;
  runtime.waitUntil(run());
};

export async function runQueuedBHCSync(uid: string, providers: Providers) {
  try {
    const started = performance.now();
    while (performance.now() - started < 45000) {
      const job = check(await service().rpc("claim_bhc_sync", { uid }));
      if (!job?.id) return;
      try {
        const result = await syncBHC(
          uid,
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
          return;
        }
        await query("job_finish", { id: job.id, status: "done" });
      } catch {
        await query("job_finish", {
          id: job.id,
          status: job.attempts < 5 ? "pending" : "failed",
          error: "BHC import failed; credentials and provider data withheld.",
          due_at: new Date(
            Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts),
          ).toISOString(),
        });
        return;
      }
    }
  } catch {
    // Never fail a committed connection response or log a provider URL/secret.
    console.error(
      "Queued BHC import could not run; scheduled worker will retry.",
    );
  }
}
