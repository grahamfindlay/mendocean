import { expect, it } from "vitest";
import { assess, features, type ModelBundle } from "../shared/model";
const weather = {
  wind: 7,
  direction: 180,
  gust: 10,
  preceding: [{ wind: 5 }, { wind: 9 }],
};
const context = { route: "either", boat: "any", coach: "none" };
const model: ModelBundle = {
  version: "test",
  eligible: true,
  context: "weather_only",
  pooled: {
    launch: {
      eligible: true,
      outings: 100,
      coefficients: [0, 0, 0, 0, 0, 0, 0, 0],
    },
    water: {
      eligible: true,
      outings: 100,
      coefficients: [
        [2, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [1, 0, 0, 0, 0, 0, 0, 0],
        [-2, 0, 0, 0, 0, 0, 0, 0],
      ],
    },
  },
  personal: {},
};
it("never borrows the pooled model when personal data is requested", () => {
  expect(assess(model, weather, "private-user", "mine", context).source).toBe(
    "heuristic",
  );
  expect(
    assess(model, weather, null, "pooled", context).launch_probability,
  ).toBe(0.5);
});
it("only returns learned probabilities after approval/eligibility", () => {
  expect(
    assess(null, weather, null, "pooled", context).launch_probability,
  ).toBeNull();
  expect(
    assess({ ...model, eligible: false }, weather, null, "pooled", context)
      .launch_probability,
  ).toBeNull();
});
it("keeps ordinal probabilities nonnegative and normalized", () => {
  const result = assess(model, weather, null, "pooled", context);
  expect(result.water_probabilities!.every((n) => n >= 0)).toBe(true);
  expect(result.water_probabilities!.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  expect(result.forced_off_probability).toBe(result.water_probabilities![4]);
});
it("declares unsupported coach or route factors rather than implying personalization", () => {
  expect(
    assess(model, weather, null, "pooled", { ...context, coach: "Charlie" })
      .source,
  ).toBe("heuristic");
  expect(
    assess(model, weather, null, "pooled", { ...context, route: "east" })
      .source,
  ).toBe("heuristic");
});
it("matches the training feature layout and distinguishes missing gusts", () => {
  expect(features(weather)).toHaveLength(8);
  expect(features({ ...weather, gust: null })![6]).toBe(1);
  expect(features({ ...weather, wind: null })).toBeNull();
});

it("uses a qualified context without leaking a pooled context into personal forecasts", () => {
  const pooled = {
    ...model.pooled,
    contextual: {
      "east|any|Charlie": {
        launch: model.pooled.launch,
        water: model.pooled.water,
      },
    },
  };
  expect(
    assess({ ...model, pooled }, weather, null, "pooled", {
      route: "east",
      boat: "any",
      coach: "Charlie",
    }).launch_probability,
  ).toBe(0.5);
  expect(
    assess({ ...model, pooled }, weather, "new-user", "mine", {
      route: "east",
      boat: "any",
      coach: "Charlie",
    }).launch_probability,
  ).toBeNull();
});
