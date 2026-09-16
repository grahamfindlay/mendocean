import { liveProviders, type Providers } from "./providers.ts";
import {
  reminderEligible,
  reminderChannels,
} from "../../../shared/reminders.ts";
import { formatDate, formatTime } from "../../../shared/domain.ts";
import { check, env, query, service, HttpError } from "./runtime.ts";
export async function sendReminder(
  uid: string,
  outingId: string,
  generation = 0,
  providers: Providers = liveProviders,
) {
  const db = service();
  const [pr, mr, rr, or] = await Promise.all([
    db.from("profiles").select("*").eq("id", uid).single(),
    db
      .from("outing_members")
      .select("*")
      .eq("outing_id", outingId)
      .eq("user_id", uid)
      .single(),
    db
      .from("reports")
      .select("id")
      .eq("outing_id", outingId)
      .eq("user_id", uid)
      .maybeSingle(),
    db.from("outings").select("*").eq("id", outingId).single(),
  ]);
  const profile = check(pr),
    member = check(mr),
    report = check(rr),
    outing = check(or);
  if (
    !reminderEligible(
      {
        attendance: member.attendance,
        reminder: member.reminder,
        skipped: member.skipped,
        hasReport: !!report,
        paused: profile.reminders_paused,
        channels: reminderChannels(profile),
        endsAt: outing.ends_at,
      },
      providers.now(),
    )
  )
    return;
  const url = env("APP_URL") + "/?log=" + outingId;
  const title = "How was the water?";
  const body = `${outing.title} · ${formatDate(outing.starts_at)}, ${formatTime(outing.starts_at)}. A quick report helps the next row.`;
  let failed = false;
  for (const channel of reminderChannels(profile)) {
    const args = {
      uid,
      outing: outingId,
      gen: generation,
      target_channel: channel,
    };
    const reserved = check(await db.rpc("reserve_reminder_channel", args));
    if (!reserved.allowed) {
      if (reserved.quota || reserved.busy) failed = true;
      continue;
    }
    const active = async (endpoint: string | null = null) =>
      check(
        await db.rpc("reminder_channel_active", {
          ...args,
          token: reserved.token,
          target_endpoint: endpoint,
        }),
      );
    let failure: string | null = null;
    try {
      if (!(await active())) {
        failure = "cancelled";
        continue;
      }
      if (channel === "email") {
        const { data, error } = await db.auth.admin.getUserById(uid);
        if (error || !data.user.email) throw new Error("Email unavailable");
        const message = check(
          await db.rpc("prepare_reminder_email", {
            uid,
            outing: outingId,
            gen: generation,
            token: reserved.token,
            message: {
              from: env("EMAIL_FROM"),
              to: [data.user.email],
              subject: title,
              text:
                body +
                "\n\nLog your outing: " +
                url +
                "\n\nManage or pause reminders: " +
                env("APP_URL") +
                "/?account=1",
            },
          }),
        );
        if (!message) {
          failure = "cancelled";
          continue;
        }
        const response = await providers.fetch(
          "https://api.resend.com/emails",
          {
            method: "POST",
            signal: AbortSignal.timeout(10000),
            headers: {
              Authorization: `Bearer ${env("RESEND_API_KEY")}`,
              "Content-Type": "application/json",
              "Idempotency-Key": reserved.key,
            },
            body: JSON.stringify(message),
          },
        );
        if (!response.ok) throw new Error("Email delivery failed");
      } else {
        const subscriptions = await query("push_get", { user_id: uid });
        const previous: {
          endpoint: string;
          sent: boolean;
          expired: boolean;
        }[] = reserved.devices || [];
        let sent = previous.filter((d) => d.sent).length;
        const deadline = Date.now() + 30000;
        for (const subscription of subscriptions) {
          if (
            previous.some((d) => d.endpoint === subscription.endpoint && d.sent)
          )
            continue;
          if (Date.now() >= deadline) {
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
                body,
                url,
                tag: `outing-${outingId}-${generation}`,
              }),
              {
                TTL: Math.max(
                  0,
                  Math.min(
                    86400,
                    Math.floor(
                      (Date.parse(outing.ends_at) +
                        86400000 -
                        providers.now()) /
                        1000,
                    ),
                  ),
                ),
                timeout: 10000,
              },
            );
          } catch (e) {
            if ([404, 410].includes((e as { statusCode: number }).statusCode)) {
              check(
                await db.rpc("finish_reminder_device", {
                  uid,
                  outing: outingId,
                  gen: generation,
                  token: reserved.token,
                  target_endpoint: subscription.endpoint,
                  gone: true,
                }),
              );
              await query("push_delete", { endpoint: subscription.endpoint });
            } else failure = "provider_failed";
            continue;
          }
          // Checkpoint each accepted endpoint before another device is attempted.
          check(
            await db.rpc("finish_reminder_device", {
              uid,
              outing: outingId,
              gen: generation,
              token: reserved.token,
              target_endpoint: subscription.endpoint,
              gone: false,
            }),
          );
          sent++;
        }
        if (!sent && !failure) failure = "no_device";
      }
    } catch {
      failure = "provider_failed";
    } finally {
      check(
        await db.rpc("finish_reminder_channel", {
          ...args,
          token: reserved.token,
          failure,
        }),
      );
    }
    if (failure && failure !== "cancelled") failed = true;
  }
  if (failed) throw new Error("One or more reminder channels need retry");
}

export async function sendTestPush(
  uid: string,
  endpoint: string,
  providers: Providers = liveProviders,
) {
  const subscriptions = await query("push_get", { user_id: uid });
  const subscription = subscriptions.find(
    (s: { endpoint: string }) => s.endpoint === endpoint,
  );
  if (!subscription)
    throw new HttpError(
      400,
      "Enable push on this device while signed into this account first.",
    );
  try {
    await providers.push(
      subscription,
      JSON.stringify({
        title: "Mendocean test notification",
        body: "Push notifications are working on this device.",
        url: env("APP_URL") + "/?account=1",
        tag: "mendocean-push-test",
      }),
      { TTL: 300, timeout: 10000 },
    );
  } catch (error) {
    if (
      [404, 410].includes((error as { statusCode?: number }).statusCode || 0)
    ) {
      await query("push_delete", { endpoint });
      throw new HttpError(
        400,
        "This device registration has expired. Enable push again, then retry the test.",
      );
    }
    throw new HttpError(
      502,
      "The push service did not accept the test. Please try again.",
    );
  }
}
