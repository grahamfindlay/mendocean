import { expect, test } from "vitest";
// @ts-expect-error JavaScript deployment helper has no declaration file.
import { validateStagingConfig } from "../scripts/staging/lib.mjs";
const target = {
  supabase_ref: "zkuorkfrwxfnjfgjygah",
  supabase_url: "https://zkuorkfrwxfnjfgjygah.supabase.co",
  production_supabase_ref: "exhoyifhvultmjryisce",
  supabase_name: "mendocean-staging",
  pages_project: "mendocean-staging",
  app_url: "https://mendocean-staging.pages.dev",
};
test("staging deployment refuses production database even if editable config is changed", () => {
  expect(() => validateStagingConfig(target)).not.toThrow();
  expect(() =>
    validateStagingConfig({
      ...target,
      supabase_ref: "exhoyifhvultmjryisce",
      production_supabase_ref: "other",
    }),
  ).toThrow("Refusing");
  for (const override of [
    { supabase_url: "https://exhoyifhvultmjryisce.supabase.co" },
    { supabase_name: "mendocean" },
    { pages_project: "mendocean" },
    { app_url: "https://mendocean.fyi" },
    { app_url: "https://mendocean.pages.dev" },
    { app_url: "http://mendocean-staging.pages.dev" },
  ])
    expect(() => validateStagingConfig({ ...target, ...override })).toThrow(
      "Refusing",
    );
});
