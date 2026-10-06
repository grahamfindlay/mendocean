import { digestDue, digestText, digestWindow } from "../../../shared/digest.ts";
import type { Operations, WeekSummary } from "../../../shared/monitoring.ts";
import type { Providers } from "./providers.ts";
import { env, service } from "./runtime.ts";
import { monitoring } from "./observability.ts";
async function analyticsSummary(
  start: string,
  end: string,
  providers: Providers,
) {
  const key = Deno.env.get("POSTHOG_READ_KEY");
  const project = Deno.env.get("POSTHOG_PROJECT_ID");
  const host = Deno.env.get("POSTHOG_API_HOST") || "https://us.posthog.com";
  if (
    !key ||
    !project ||
    !/^\d+$/.test(project) ||
    !["https://us.posthog.com", "https://eu.posthog.com"].includes(host)
  )
    return null;
  try {
    const { data: owners, error } = await service()
      .from("profiles")
      .select("id")
      .eq("role", "admin");
    if (error) return null;
    const ownerIds = (owners || [])
      .map((p: { id: string }) => p.id)
      .filter((id: string) => /^[a-f\d-]{36}$/i.test(id));
    const excludeOwners = ownerIds.length
      ? ` AND distinct_id NOT IN (${ownerIds.map((id: string) => `'${id}'`).join(",")})`
      : "";
    const queryStart = new Date(start)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const queryEnd = new Date(end).toISOString().slice(0, 19).replace("T", " ");
    // Dates are generated server-side; no user-supplied SQL or person/report data.
    const response = await providers.fetch(
      `${host}/api/projects/${project}/query/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: {
            kind: "HogQLQuery",
            query: `SELECT countIf(event='view_opened' AND properties.screen IN ('Today','Week','Rows')), countIf(event='$exception') FROM events WHERE timestamp >= toDateTime('${queryStart}','UTC') AND timestamp < toDateTime('${queryEnd}','UTC')${excludeOwners}`,
          },
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const [views, errors] = data.results?.[0] || [];
    if (
      ![views, errors].every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
      )
    )
      return null;
    return { forecast_views: views as number, errors: errors as number };
  } catch {
    return null;
  }
}
export async function ownerDigest(preview: boolean, providers: Providers) {
  const now = providers.now();
  if (!preview && !digestDue(now))
    return { skipped: "outside_delivery_window" };
  if (!preview && Deno.env.get("OWNER_DIGEST_ENABLED") !== "true")
    return { skipped: "disabled" };
  const window = digestWindow(now);
  const previousWindow = digestWindow(Date.parse(window.start));
  const [summary, previous, operations, analytics] = await Promise.all([
    monitoring("summary", window),
    monitoring("summary", previousWindow),
    monitoring("operations"),
    analyticsSummary(window.start, window.end, providers),
  ]);
  const site = env("APP_URL");
  const text = digestText(
    summary as WeekSummary,
    previous as WeekSummary,
    operations as Operations,
    analytics,
    site,
    Deno.env.get("POSTHOG_API_HOST") === "https://eu.posthog.com"
      ? "https://eu.posthog.com"
      : "https://us.posthog.com",
  );
  if (preview) return { week: window.week, text };
  const email = env("OWNER_EMAIL");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Owner email is invalid");
  const db = service();
  const { data: owners, error: ownerError } = await db
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .eq("approved", true);
  if (ownerError) throw new Error("Owner verification failed");
  let verified = false;
  for (const owner of owners || []) {
    const { data, error } = await db.auth.admin.getUserById(owner.id);
    if (
      !error &&
      data.user?.email_confirmed_at &&
      data.user.email?.toLowerCase() === email.toLowerCase()
    )
      verified = true;
  }
  if (!verified)
    throw new Error(
      "Digest recipient must be a verified, approved administrator",
    );
  const payload = {
    from: env("EMAIL_FROM"),
    to: email,
    subject: `Mendocean weekly report · ${window.week}`,
    text,
  };
  const reservation = await monitoring("digest_reserve", {
    week: window.week,
    payload,
  });
  if (!reservation.allowed)
    return { skipped: "already_sent_reserved_or_expired" };
  if (reservation.payload.to !== email)
    throw new Error("Digest recipient changed during the retry window");
  let accepted = false;
  try {
    const response = await providers.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `owner-digest:${window.week}`,
      },
      body: JSON.stringify(reservation.payload),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Owner digest delivery failed");
    accepted = true;
    return { accepted: true, week: window.week };
  } finally {
    await monitoring("digest_finish", {
      week: window.week,
      lease: reservation.lease,
      sent: accepted,
    });
  }
}
