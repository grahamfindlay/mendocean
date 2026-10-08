import { service } from "./runtime.ts";
class MonitoringError extends Error {
  constructor(public code: string) {
    super("Monitoring operation failed");
  }
}
const operations = new Set([
  "weather",
  "assessment",
  "account",
  "report",
  "report/delete",
  "settings",
  "outing",
  "bhc/attendance",
  "bhc/connect",
  "bhc/disconnect",
  "bhc/sync",
  "push",
  "admin",
  "dispatcher",
]);
export const operationName = (path: string) =>
  path === "bhc/connect-password"
    ? "bhc/connect"
    : operations.has(path)
      ? path
      : path.startsWith("admin/")
        ? "admin"
        : path.startsWith("push/")
          ? "push"
          : "unknown";
export async function monitoring(
  action: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await service().rpc("monitoring_query", {
    action,
    args,
  });
  if (error)
    throw new MonitoringError(
      /^[\w]{1,20}$/.test(error.code) ? error.code : "unknown",
    );
  return data;
}
export async function observeFailure(
  operation: string,
  requestId: string,
  userId: string | null,
  duration: number,
) {
  const entry = {
    severity: "error",
    operation: operationName(operation),
    request_id: requestId,
    user_id: userId,
    outcome: "failed",
    duration_ms: Math.max(0, Math.round(duration)),
  };
  console.error(JSON.stringify(entry));
  try {
    await monitoring("api_failure", entry);
  } catch {
    /* Logs remain available when the DB is down. */
  }
}
export async function optionalMonitoring(
  action: string,
  args: Record<string, unknown> = {},
) {
  try {
    return await monitoring(action, args);
  } catch (error) {
    console.warn(
      JSON.stringify({
        operation: "monitoring",
        outcome: "unavailable",
        code: error instanceof MonitoringError ? error.code : "unknown",
      }),
    );
  }
}
