import { readFileSync } from "node:fs";
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
const jpeg = readFileSync(new URL("../fixtures/camera.jpg", import.meta.url));
test("camera is opt-in, rate limited, pauses and cleans up", async ({
  page,
}) => {
  const starts: number[] = [];
  await page.route("**/api/lake-camera.jpg", async (route) => {
    starts.push(Date.now());
    await route.fulfill({ contentType: "image/jpeg", body: jpeg });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Show lake camera" }),
  ).toBeVisible();
  expect(starts).toHaveLength(0);
  await page.getByRole("button", { name: "Show lake camera" }).click();
  await expect(
    page.getByAltText("Lake Mendota from the UW–Madison Center for Limnology"),
  ).toBeVisible();
  await expect.poll(() => starts.length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < starts.length; i++)
    expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(900);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const paused = starts.length;
  await page.waitForTimeout(1200);
  expect(starts).toHaveLength(paused);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => starts.length).toBeGreaterThan(paused);
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.id = "camera-test-spacer";
    spacer.style.height = "4000px";
    document.body.append(spacer);
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(200);
  const offscreen = starts.length;
  await page.waitForTimeout(1200);
  expect(starts).toHaveLength(offscreen);
  await page
    .getByRole("button", { name: "Hide camera" })
    .scrollIntoViewIfNeeded();
  await expect.poll(() => starts.length).toBeGreaterThan(offscreen);
  await page.getByRole("button", { name: "Hide camera" }).click();
  const closed = starts.length;
  await page.waitForTimeout(1200);
  expect(starts).toHaveLength(closed);
  await expect(page.locator(".lake-camera-image")).toHaveCount(0);
  await page.getByRole("button", { name: "Show lake camera" }).click();
  await expect.poll(() => starts.length).toBeGreaterThan(closed);
  await page.getByRole("button", { name: "Week", exact: true }).click();
  const left = starts.length;
  await page.waitForTimeout(1200);
  expect(starts).toHaveLength(left);
});
test("slow requests do not overlap and failures back off", async ({ page }) => {
  const starts: number[] = [];
  await page.route("**/api/lake-camera.jpg", async (route) => {
    starts.push(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 1400));
    await route.fulfill({ status: 502, body: "unavailable" });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Show lake camera" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Camera connection interrupted" }),
  ).toBeVisible();
  await expect.poll(() => starts.length).toBeGreaterThanOrEqual(2);
  expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(3300);
  await expect(page.getByRole("link", { name: "Open webcam" })).toBeVisible();
  await page.getByRole("button", { name: "Hide camera" }).click();
});
