import { openDB } from "idb";
import { api, previewMode } from "./client";
import type { OutingInput, ReportInput } from "../shared/domain";
export interface PendingReport {
  key: string;
  user: string;
  outing: OutingInput;
  report: ReportInput;
  savedAt: string;
  error?: string;
}
const db = openDB(
  previewMode ? "mendocean-sample-private" : "mendocean-private",
  1,
  {
    upgrade(db) {
      db.createObjectStore("outbox", { keyPath: "key" });
      db.createObjectStore("drafts");
    },
  },
);
export async function pending(user: string): Promise<PendingReport[]> {
  return (await (await db).getAll("outbox")).filter((p) => p.user === user);
}
export async function stage(
  user: string,
  outing: OutingInput,
  report: ReportInput,
) {
  await (
    await db
  ).put("outbox", {
    key: `${user}:${report.submission_id}`,
    user,
    outing,
    report,
    savedAt: new Date().toISOString(),
  });
}
export async function discard(key: string) {
  await (await db).delete("outbox", key);
}
export async function draft(user: string, value?: unknown) {
  const store = await db;
  return value === undefined
    ? store.get("drafts", user)
    : store.put("drafts", value, user);
}
export async function clearDraft(user: string) {
  await (await db).delete("drafts", user);
}
export async function flush(user: string) {
  let sent = 0;
  const items = await pending(user);
  for (const item of items) {
    try {
      await api("report", { outing: item.outing, report: item.report }, user);
      await discard(item.key);
      sent++;
    } catch (error) {
      item.error = error instanceof Error ? error.message : "Upload failed";
      await (await db).put("outbox", item);
      break;
    }
  }
  return { sent, remaining: await pending(user) };
}
