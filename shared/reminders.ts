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
/**
 * Why a row cannot carry a logging reminder. A code rather than a sentence:
 * a card showing "you are not attending this practice" on every practice is
 * prose the owner already knows, while the API still needs the wording.
 */
export type ReminderBlock =
  | "reported"
  | "not_attending"
  | "paused"
  | "no_channel"
  | "not_ended"
  | "window_closed";
/** Blocks the owner clears once in Account rather than row by row. */
const ACCOUNT_BLOCKS: readonly ReminderBlock[] = ["paused", "no_channel"];
const BLOCK_MESSAGES: Record<ReminderBlock, string> = {
  reported: "This row already has a report.",
  not_attending: "Logging reminders are available for rows you are attending.",
  paused: "Logging reminders are paused in Account.",
  no_channel: "Choose a logging reminder channel in Account first.",
  not_ended: "You can postpone a logging reminder after the row ends.",
  window_closed:
    "The logging reminder window has ended. You can still log this row anytime.",
};
export function reminderBlockMessage(block: ReminderBlock): string {
  return BLOCK_MESSAGES[block];
}
export function reminderBlock(
  o: Pick<Outing, "ends_at" | "attendance"> & { reports?: readonly unknown[] },
  profile: ReminderProfile,
  action: "enable" | "snooze",
  now: number,
): ReminderBlock | null {
  if (o.reports?.length) return "reported";
  if (o.attendance !== "attending") return "not_attending";
  if (profile.reminders_paused) return "paused";
  if (!reminderChannels(profile).length) return "no_channel";
  const end = Date.parse(o.ends_at);
  const due = action === "snooze" ? now + 3600000 : Math.max(now, end + 900000);
  if (action === "snooze" && now < end) return "not_ended";
  if (due > end + 86400000) return "window_closed";
  return null;
}
/**
 * The one account-level reason, if any, that stops rows in this list from
 * carrying reminders. Shown once above the list instead of on every card,
 * since the owner fixes it in one place.
 */
export function accountReminderBlock(
  outings: readonly Outing[],
  profile: ReminderProfile,
  now: number,
): ReminderBlock | null {
  for (const o of outings) {
    if (o.reports?.length || now > Date.parse(o.ends_at) + 86400000) continue;
    const block = reminderBlock(o, profile, "enable", now);
    if (block && ACCOUNT_BLOCKS.includes(block)) return block;
  }
  return null;
}
export function reminderPresentation(
  o: Outing,
  profile: ReminderProfile,
  now: number,
) {
  if (o.reports?.length || now > Date.parse(o.ends_at) + 86400000) return null;
  // A row that cannot carry a reminder says nothing at all. The reason is
  // either the situation itself, which the card already shows, or an account
  // setting that belongs above the list rather than on every card.
  if (reminderBlock(o, profile, "enable", now)) return null;
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
    toggle: on ? ("skip" as const) : ("enable" as const),
    snooze: !reminderBlock(o, profile, "snooze", now),
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
