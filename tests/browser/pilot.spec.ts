import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  const base = Math.floor(Date.now() / 3600000) * 3600000;
  const hours = Array.from({ length: 168 }, (_, i) => ({
    time: new Date(base + i * 3600000).toISOString(),
    wind: 7,
    direction: 180,
    gust: 10,
    temperature: 65,
    precipitation: 0,
    probability: 0,
    visibility: 16000,
    code: 0,
  }));
  await page.route("**/api/weather", (route) =>
    route.fulfill({
      json: {
        fetched_at: new Date().toISOString(),
        provider: "Test fixture",
        source_kind: "fixture",
        model_version: "hannah-1.0.0",
        current: hours[0],
        hours,
      },
    }),
  );
});
test("public forecast, planner, and invitation boundary", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Favorable wind" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByLabel("Window", { exact: true }).selectOption("1");
  await expect(
    page.getByText("Hourly forecast containing this time"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByText("The pilot is invitation-only.")).toBeVisible();
});
test("independent report, editing, and boat/coach details", async ({
  page,
}) => {
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page.getByRole("button", { name: "2 Good", exact: true }).click();
  await page.getByRole("button", { name: "East", exact: true }).click();
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(page.getByText("2 · Good · east")).toBeVisible();
  await page.getByRole("button", { name: "Edit report", exact: true }).click();
  await page.getByRole("button", { name: "5 Forced off", exact: true }).click();
  await page.getByLabel("Your boat", { exact: true }).selectOption("2x");
  await page.getByLabel("Coaching", { exact: true }).selectOption("known");
  await page.getByRole("button", { name: "Charlie", exact: true }).click();
  await page.getByRole("button", { name: "Rose", exact: true }).click();
  await expect(
    page.getByLabel("Coach count (from your selection)"),
  ).toHaveValue("2");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("5 · Forced off · east")).toBeVisible();
});
test("offline report is staged and uploaded after reconnecting", async ({
  page,
  context,
}) => {
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page
    .getByRole("button", { name: "Stayed ashore", exact: true })
    .click();
  await page.getByLabel("What kept you ashore?").selectOption("wind_waves");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(page.getByText("On this device · 1 pending")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("Stayed ashore", { exact: true })).toBeVisible();
  await expect(page.getByText("On this device · 1 pending")).not.toBeVisible();
});
