export function reminderEligible(
  input: {
    attendance: string;
    reminder: boolean;
    skipped: boolean;
    hasReport: boolean;
    paused: boolean;
    channel: string;
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
    input.channel !== "none" &&
    now >= Date.parse(input.endsAt) + 15 * 60000 &&
    now <= Date.parse(input.endsAt) + 24 * 3600000
  );
}
