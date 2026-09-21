import { test, expect } from "@playwright/test";

test("History shows only past rows, preserves logging actions, and resolves old links", async ({
  page,
}, testInfo) => {
  const now = Date.parse("2026-09-20T12:00:00Z");
  await page.clock.install({ time: now });
  const hours = Array.from({ length: 48 }, (_, i) => ({
    time: new Date(now + i * 3600000).toISOString(),
    wind: i === 2 ? 18 : 6,
    gust: i === 2 ? 25 : 9,
    direction: 180,
    temperature: 65,
    probability: 30,
    precipitation: 0,
    visibility: 16000,
    code: 2,
  }));
  await page.route("**/api/weather", (route) =>
    route.fulfill({
      json: {
        fetched_at: new Date(now).toISOString(),
        provider: "Test fixture",
        source_kind: "fixture",
        model_version: "hannah-1.0.0",
        current: hours[0],
        hours,
      },
    }),
  );
  await page.addInitScript(() => {
    const base = {
      kind: "official",
      version: 1,
      owner_id: null,
      bhc_practice_id: 1,
      reminder: false,
      attendance: "attending",
      reports: [],
      planned_boat: null,
    };
    localStorage.setItem(
      "mendocean-explicit-preview-v1",
      JSON.stringify([
        {
          ...base,
          id: "future",
          title: "Masters Novice & Recreational",
          starts_at: "2026-09-20T13:00:00Z",
          ends_at: "2026-09-20T15:00:00Z",
        },
        {
          ...base,
          id: "independent",
          kind: "independent",
          title: "Independent afternoon row",
          starts_at: "2026-09-20T18:00:00Z",
          ends_at: "2026-09-20T19:00:00Z",
        },
        {
          ...base,
          id: "past",
          title: "Morning practice",
          starts_at: "2026-09-19T13:00:00Z",
          ends_at: "2026-09-19T15:00:00Z",
          reports: [
            {
              id: "report",
              version: 1,
              outcome: "rowed",
              rating: 2,
              route: "east",
            },
          ],
        },
        {
          ...base,
          id: "unlogged",
          title: "Evening practice",
          starts_at: "2026-09-19T22:00:00Z",
          ends_at: "2026-09-19T23:00:00Z",
        },
      ]),
    );
  });
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("button", { name: "Upcoming", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Past", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Schedule independent row", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export my data", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Masters Novice & Recreational" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Independent afternoon row" })).toHaveCount(0);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export my data", exact: true })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export my data", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe("mendocean-my-data.json");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const past = page
    .locator(".outing-card")
    .filter({ hasText: "Morning practice" });
  await expect(past.locator(".report-summary")).toContainText("Logged");
  await expect(past.locator(".report-summary")).toContainText(
    "2 · Good · east",
  );
  await expect(past.getByRole("button", { name: "Edit report" })).toBeVisible();
  await expect(
    page.locator(".outing-card .scheduled-card-weather"),
  ).toHaveCount(0);
  const unlogged = page
    .locator(".outing-card")
    .filter({ hasText: "Evening practice" });
  await expect(unlogged).toContainText("Needs log");
  await expect(
    unlogged.getByRole("button", { name: "Log this row" }),
  ).toBeVisible();
  await past.getByRole("button", { name: "More", exact: true }).click();
  await expect(
    past.getByRole("button", { name: "Delete", exact: true }),
  ).toBeVisible();
  await past.getByRole("button", { name: "More", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("past.png"),
    fullPage: true,
  });
  await unlogged.getByRole("button", { name: "Log this row" }).click();
  await expect(page.getByRole("combobox", { name: "Which row?" })).toHaveValue("unlogged");
  await page.goto("/?preview=1&tab=My%20rows");
  await expect(page.getByRole("button", { name: "History", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".outing-card")).toHaveCount(2);
  await page.goto("/?preview=1&tab=History");
  await expect(page.getByRole("button", { name: "History", exact: true })).toHaveAttribute("aria-current", "page");

});
