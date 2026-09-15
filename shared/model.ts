export interface ModelInput {
  wind: number | null;
  direction: number | null;
  gust: number | null;
  preceding: { wind: number | null }[];
}
export interface FittedModel {
  eligible: boolean;
  outings: number;
  coefficients?: number[] | number[][];
  reason?: string | null;
}
export interface ModelFamily {
  launch: FittedModel;
  water: FittedModel;
  contextual?: Record<string, { launch: FittedModel; water: FittedModel }>;
}
export interface ModelBundle {
  version: string;
  eligible: boolean;
  context: string;
  pooled: ModelFamily;
  personal: Record<string, ModelFamily>;
}
export function features(w: ModelInput): number[] | null {
  if (
    w.wind === null ||
    w.direction === null ||
    !Number.isFinite(w.wind) ||
    !Number.isFinite(w.direction) ||
    w.wind < 0
  )
    return null;
  const prior = w.preceding
    .map((p) => p.wind)
    .filter((n): n is number => n !== null && Number.isFinite(n));
  const radians = (w.direction * Math.PI) / 180;
  return [
    1,
    w.wind / 20,
    (w.gust ?? 0) / 30,
    Math.sin(radians),
    Math.cos(radians),
    prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length / 20 : 0,
    Number(w.gust === null),
    Number(!prior.length),
  ];
}
const logistic = (coef: number[], x: number[]) =>
  1 /
  (1 +
    Math.exp(
      -Math.max(
        -35,
        Math.min(
          35,
          coef.reduce((s, c, i) => s + c * x[i], 0),
        ),
      ),
    ));
export function assess(
  bundle: ModelBundle | null,
  weather: ModelInput,
  user: string | null,
  basis: "pooled" | "mine",
  context: { route: string; boat: string; coach: string },
) {
  const fallback = {
    source: "heuristic",
    reason: "There is not enough validated data for this estimate.",
    launch_probability: null,
    water_probabilities: null,
    forced_off_probability: null,
    outings: 0,
  };
  if (!bundle?.eligible) return fallback;
  const base =
    basis === "mine"
      ? user
        ? bundle.personal[user]
        : undefined
      : bundle.pooled;
  if (!base) return fallback;
  const key = [context.route, context.boat, context.coach].join("|");
  const family = key === "either|any|none" ? base : base.contextual?.[key];
  if (!family)
    return {
      ...fallback,
      reason:
        "A validated model for this route, boat, or coach is not available yet.",
    };
  const x = features(weather);
  if (!x) return { ...fallback, reason: "Required weather is unavailable." };
  const launch =
    family.launch.eligible && family.launch.coefficients
      ? logistic(family.launch.coefficients as number[], x)
      : null;
  const cumulative =
    family.water.eligible && family.water.coefficients
      ? (family.water.coefficients as number[][]).map((c) => logistic(c, x))
      : null;
  // Project cumulative exceedance probabilities to a monotone sequence before differencing.
  if (cumulative)
    for (let i = 1; i < 4; i++)
      cumulative[i] = Math.min(cumulative[i - 1], cumulative[i]);
  const water = cumulative
    ? [
        1 - cumulative[0],
        cumulative[0] - cumulative[1],
        cumulative[1] - cumulative[2],
        cumulative[2] - cumulative[3],
        cumulative[3],
      ]
    : null;
  return launch === null && water === null
    ? fallback
    : {
        source: bundle.version,
        reason: null,
        launch_probability: launch,
        water_probabilities: water,
        forced_off_probability: water?.[4] ?? null,
        outings: Math.max(family.launch.outings, family.water.outings),
      };
}
