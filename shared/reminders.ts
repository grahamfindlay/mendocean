import type { Outing } from "./domain.ts";

export interface ReminderProfile {
  reminder_channel?: string;
  reminder_channels?: string[];
  reminders_paused: boolean;
}
export type ReminderChannel = "email" | "push";
export function reminderChannels(
  profile: Pick<ReminderProfile, "reminder_channel" | "reminder_channels">,
): ReminderChannel[] {
  return [
    ...new Set(profile.reminder_channels ?? [profile.reminder_channel]),
  ].filter((c): c is ReminderChannel => c === "email" || c === "push");
}
export function reminderScheduleError(
  o: Pick<Outing, "ends_at" | "attendance"> & { reports?: readonly unknown[] },
  profile: ReminderProfile,
  action: "enable" | "snooze",
  now: number,
): string | null {
  if (o.reports?.length) return "This row already has a report.";
  if (o.attendance !== "attending")
    return "Logging reminders are available for rows you are attending.";
  if (profile.reminders_paused)
    return "Logging reminders are paused in Account.";
  if (!reminderChannels(profile).length)
    return "Choose a logging reminder channel in Account first.";
  const end = Date.parse(o.ends_at);
  const due = action === "snooze" ? now + 3600000 : Math.max(now, end + 900000);
  if (action === "snooze" && now < end)
    return "You can postpone a logging reminder after the row ends.";
  if (due > end + 86400000)
    return "The logging reminder window has ended. You can still log this row anytime.";
  return null;
}
export function reminderPresentation(
  o: Outing,
  profile: ReminderProfile,
  now: number,
) {
  if (o.reports?.length || now > Date.parse(o.ends_at) + 86400000) return null;
  const error = reminderScheduleError(o, profile, "enable", now);
  if (error)
    return {
      text: error,
      settings: profile.reminders_paused || !reminderChannels(profile).length,
      toggle: null,
      snooze: false,
    };
  const on = o.reminder && !o.skipped;
  const sent = o.reminder_state?.sent_at;
  const channelStates = o.reminder_state?.channels || [];
  const partial = channelStates.some((c) => c.sent_at || c.devices_sent);
  const failed = channelStates.some((c) => c.status === "failed");
  const due = on && !sent ? o.reminder_state?.due_at : null;
  return {
    text: !on
      ? "Logging reminder: Off"
      : sent
        ? "Logging reminder sent"
        : partial
          ? "Logging reminder partially sent"
          : failed
            ? "Logging reminder could not be delivered"
            : due
              ? "Logging reminder scheduled"
              : "Logging reminder: On",
    partial,
    due: due || undefined,
    sent: on ? sent || undefined : undefined,
    settings: false,
    toggle: on ? ("skip" as const) : ("enable" as const),
    snooze: !reminderScheduleError(o, profile, "snooze", now),
  };
}
export function reminderEligible(
  input: {
    attendance: string;
    reminder: boolean;
    skipped: boolean;
    hasReport: boolean;
    paused: boolean;
    channel?: string;
    channels?: string[];
    endsAt: string;
  },
  now = Date.now(),
): boolean {
  return (
    input.attendance === "attending" &&
    input.reminder &&
    !input.skipped &&
    !input.hasReport &&
    !input.paused &&
    reminderChannels({
      reminder_channel: input.channel,
      reminder_channels: input.channels,
    }).length > 0 &&
    now >= Date.parse(input.endsAt) + 15 * 60000 &&
    now <= Date.parse(input.endsAt) + 24 * 3600000
  );
}
