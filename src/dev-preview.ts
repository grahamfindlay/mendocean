import { DEFAULT_WEEK_PERIODS, weekPeriodsSchema } from "../shared/weekPeriods";
// Development-only fixture adapter. Vite removes this import from production builds.
import { COACH_NAMES, type Outing, type Report } from "../shared/domain";
const USER = "10000000-0000-4000-8000-000000000001";
const KEY = "mendocean-explicit-preview-v1";
const load = (): Outing[] => JSON.parse(localStorage.getItem(KEY) || "[]");
const save = (o: Outing[]) => localStorage.setItem(KEY, JSON.stringify(o));
export async function previewAPI(path: string, body: any) {
  const outings = load();
  if (path === "week-periods") {
    const key = "mendocean-preview-week-periods";
    if (body) localStorage.setItem(key, JSON.stringify(weekPeriodsSchema.parse(body.periods)));
    return { periods: JSON.parse(localStorage.getItem(key) || "null") ?? DEFAULT_WEEK_PERIODS };
  }
  if (path === "account")
    return {
      outings,
      push_devices: 0,
      coaches: COACH_NAMES.map((name, i) => ({
        name,
        id: `30000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      })),
      profile: {
        display_name: "Sample rower",
        role: "member",
        reminder_channel: "none",
        reminders_paused: false,
      },
      bhc: { connected: false, last_sync: null, last_error: null },
    };
  if (path === "report") {
    let outing = outings.find((o) => o.id === body.outing.id);
    if (!outing) {
      outing = {
        ...body.outing,
        attendance: "attending",
        owner_id: USER,
        bhc_practice_id: null,
        version: 1,
        reports: [],
      };
      outings.push(outing!);
    }
    const previous = outing!.reports?.[0];
    if (previous && previous.submission_id === body.report.submission_id)
      return { id: previous.id, version: previous.version };
    if ((previous?.version || 0) !== body.report.expected_version)
      throw new Error("This report changed. Reload it before editing.");
    const report: Report = {
      ...body.report,
      id: previous?.id || crypto.randomUUID(),
      outing_id: outing!.id,
      user_id: USER,
      version: (previous?.version || 0) + 1,
      created_at: new Date().toISOString(),
    };
    outing!.reports = [report];
    save(outings);
    return { id: report.id, version: report.version };
  }
  if (path === "report/delete") {
    for (const o of outings)
      o.reports = o.reports?.filter((r) => r.id !== body.id);
    save(outings);
    return { deleted: true };
  }
  if (path === "outing") {
    const outing = {
      ...body,
      attendance: "attending",
      owner_id: USER,
      bhc_practice_id: null,
      version: 1,
    };
    outings.push(outing);
    save(outings);
    return outing;
  }
  if (path === "export") return { outings, sample: true };
  if (path === "settings" || path === "reminder") return { saved: true };
  throw new Error(
    "This action requires a real Supabase account and is unavailable in the sample preview.",
  );
}
