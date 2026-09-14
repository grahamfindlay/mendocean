import { test, expect } from "vitest";
import {
  validateForecast,
  requireDenied,
  validateAuth,
} from "./smoke/checks.mjs";
const forecast = () => ({
  fetched_at: new Date().toISOString(),
  hours: Array.from({ length: 145 }, (_, i) => ({
    time: new Date(Date.now() + i * 3600000).toISOString(),
    wind: 7,
    direction: 180,
  })),
});
test("smoke fails stale weather even when HTTP succeeded", () => {
  const f = forecast();
  expect(() => validateForecast(f)).not.toThrow();
  f.fetched_at = new Date(Date.now() - 91 * 60000).toISOString();
  expect(() => validateForecast(f)).toThrow("weather-freshness");
});
test("smoke fails missing future coverage and a permissive private endpoint", () => {
  const f = forecast();
  f.hours = f.hours.slice(0, 2);
  expect(() => validateForecast(f)).toThrow("coverage");
  expect(() => requireDenied(200)).toThrow("authorization");
  expect(() => requireDenied(401)).not.toThrow();
});
test("smoke catches disabled email provider and public signup", () => {
  expect(() =>
    validateAuth({ external: { email: false }, disable_signup: true }),
  ).toThrow();
  expect(() =>
    validateAuth({ external: { email: true }, disable_signup: false }),
  ).toThrow();
  expect(() =>
    validateAuth({ external: { email: true }, disable_signup: true }),
  ).not.toThrow();
});
