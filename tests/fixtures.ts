import type { ReportInput } from "../shared/domain";
export const ALICE = "10000000-0000-4000-8000-000000000001";
export const BOB = "10000000-0000-4000-8000-000000000002";
export const OUTING = "20000000-0000-4000-8000-000000000001";
export const report = (overrides: Partial<ReportInput> = {}): ReportInput => ({
  submission_id: crypto.randomUUID(),
  expected_version: 0,
  outcome: "rowed",
  scope: "personal",
  reason: null,
  rating: 2,
  route: "east",
  boat_class: "1x",
  launched_boats: [],
  coach_state: "uncoached",
  coach_ids: [],
  coach_count: 0,
  smallest_boat: null,
  largest_boat: null,
  actual_start: "2026-09-10T12:00:00Z",
  actual_end: "2026-09-10T13:00:00Z",
  notes: "",
  segments: [],
  ...overrides,
});
