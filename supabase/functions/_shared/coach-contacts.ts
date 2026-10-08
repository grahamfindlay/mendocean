import type { Lineup } from "../../../shared/lineups.ts";
import { contactEmail } from "../../../shared/lineup-display.ts";

// Verified October 7, 2026. MRC-specific overrides use stable BHC member IDs.
// Sources: https://mendotarowingclub.com/Coaches and /Roles;
// Leigh Hatton's club address was verified in the member directory.
export const MRC_COACH_EMAILS: Readonly<Record<number, string>> = {
  17594: "awencel@mendotarowingclub.com",
  17609: "rkite@mendotarowingclub.com",
  17620: "hswan@mendotarowingclub.com",
  17621: "sstrugar@mendotarowingclub.com",
  17622: "tstulting@mendotarowingclub.com",
  17625: "cwesthoff@mendotarowingclub.com",
  17626: "swinn@mendotarowingclub.com",
  17627: "rsears@mendotarowingclub.com",
  18117: "lhatton@mendotarowingclub.com",
};

export function coachContactLookup(
  club: number,
  readDirectory: () => Promise<Record<string, any>[]>,
) {
  // One directory request per import/poll, only when an assigned coach needs it.
  // Keep just ID/address pairs in memory; never persist the member directory.
  let directory: Promise<Map<number, string>> | undefined;
  return async (lineup: Lineup) => {
    const coaches = lineup.boats.flatMap((b) => b.coaches);
    const unresolved = coaches.filter(
      (c) => !(club === 2362 && MRC_COACH_EMAILS[c.athlete_id]),
    );
    if (unresolved.length && !directory) {
      directory = (async () => {
        try {
          const members = await readDirectory();
          const addresses = new Map<number, string>();
          for (const member of members) {
            const email = contactEmail(member.email);
            if (email) addresses.set(Number(member.custid), email);
          }
          return addresses;
        } catch {
          // Contact lookup is optional: a directory outage must not hide lineups.
          return new Map<number, string>();
        }
      })();
    }
    const addresses = directory ? await directory : new Map<number, string>();
    for (const coach of coaches) {
      const email =
        (club === 2362 && MRC_COACH_EMAILS[coach.athlete_id]) ||
        addresses.get(coach.athlete_id);
      if (email) coach.email = email;
    }
  };
}
