import webpush from "web-push";
import { reminderEligible } from "../../../shared/reminders.ts";
import { formatDate, formatTime } from "../../../shared/domain.ts";
import { check, env, query, service } from "./runtime.ts";
export async function sendReminder(
  uid: string,
  outingId: string,
  generation = 0,
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
    !reminderEligible({
      attendance: member.attendance,
      reminder: member.reminder,
      skipped: member.skipped,
      hasReport: !!report,
      paused: profile.reminders_paused,
      channel: profile.reminder_channel,
      endsAt: outing.ends_at,
    })
  )
    return;
  const reserved = check(
    await db.rpc("reserve_delivery", {
      uid,
      outing: outingId,
      gen: generation,
      channel: profile.reminder_channel,
    }),
  );
  if (!reserved.allowed) {
    if (reserved.quota) throw new Error("Daily reminder email budget reached");
    return;
  }
  const url = env("APP_URL") + "/?log=" + outingId;
  const title = "How was the water?";
  const body = `${outing.title} · ${formatDate(outing.starts_at)}, ${formatTime(outing.starts_at)}. A quick report helps the next row.`;
  const channel = reserved.channel || profile.reminder_channel;
  if (channel === "email") {
    const { data, error } = await db.auth.admin.getUserById(uid);
    if (error || !data.user.email)
      throw new Error("Reminder email unavailable");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `reminder/${uid}/${outingId}/${generation}`,
      },
      body: JSON.stringify({
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
      }),
    });
    if (!response.ok) throw new Error("Email delivery failed");
  } else {
    const subscriptions = await query("push_get", { user_id: uid });
    if (!subscriptions.length) throw new Error("No push device registered");
    webpush.setVapidDetails(
      env("VAPID_SUBJECT"),
      env("VAPID_PUBLIC_KEY"),
      env("VAPID_PRIVATE_KEY"),
    );
    let sent = 0;
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({ title, body, url, tag: `outing-${outingId}` }),
          { TTL: 86400 },
        );
        sent++;
      } catch (e) {
        if ([404, 410].includes((e as { statusCode: number }).statusCode))
          await query("push_delete", { endpoint: subscription.endpoint });
      }
    }
    if (!sent) throw new Error("Push delivery failed");
  }
  check(
    await db.rpc("finish_delivery", { uid, outing: outingId, gen: generation }),
  );
}
