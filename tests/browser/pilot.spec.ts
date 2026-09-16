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
    page.getByRole("heading", { name: "Now", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Forecast", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Window", exact: true })
    .selectOption("1");
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
  await page
    .getByRole("combobox", { name: "Your boat", exact: true })
    .selectOption("2x");
  await page
    .getByRole("combobox", { name: "Coaching", exact: true })
    .selectOption("known");
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

test("future outing stays forecast-only, past rows sort and saved reports have no reminders", async ({
  page,
}) => {
  const now = Date.parse("2026-09-15T14:24:00Z");
  await page.clock.install({ time: now });
  await page.addInitScript(() => {
    const base = {
      kind: "official",
      version: 1,
      owner_id: null,
      bhc_practice_id: 100,
      reminder: true,
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
          title: "Tomorrow practice",
          starts_at: "2026-09-16T14:00:00Z",
          ends_at: "2026-09-16T15:30:00Z",
        },
        {
          ...base,
          id: "old",
          title: "Older practice",
          attendance: "declined",
          starts_at: "2026-09-13T14:00:00Z",
          ends_at: "2026-09-13T15:30:00Z",
        },
        {
          ...base,
          id: "recent",
          title: "Recent practice",
          starts_at: "2026-09-14T14:00:00Z",
          ends_at: "2026-09-14T15:30:00Z",
        },
      ]),
    );
  });
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "My outings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tomorrow practice" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Log this outing" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "View forecast", exact: true })
    .click();
  await expect(page.getByLabel("Start time · Madison")).toHaveValue(
    "2026-09-16T09:00",
  );
  await expect(
    page.getByRole("combobox", { name: "Window", exact: true }),
  ).toHaveValue("90");
  await expect(
    page.getByRole("combobox", { name: "Route", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Coach factor", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Log", exact: true }).click();
  const options = page
    .getByRole("combobox", { name: "Which outing?" })
    .locator("option");
  await expect(options).toHaveText([
    "＋ Independent / unofficial outing",
    /Recent practice/,
    /Older practice/,
  ]);
  await page.getByRole("button", { name: "My outings", exact: true }).click();
  await page.getByRole("button", { name: "Past", exact: true }).click();
  await expect(page.locator(".outing-card h3")).toHaveText([
    "Recent practice",
    "Older practice",
  ]);
  await expect(page.getByText("Not attending", { exact: true })).toBeVisible();
});

test("uninstalled iOS explains Home Screen setup before requesting permission", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
  });
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(
    page.getByText(/install Mendocean on your Home Screen/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Enable push on this device",
      exact: true,
    }),
  ).toBeDisabled();
});

test("wind bearing indicates source direction and a current sample keeps its valid time", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-15T14:24:00Z") });
  await page.route("**/api/weather", (route) =>
    route.fulfill({
      json: {
        fetched_at: "2026-09-15T14:20:00Z",
        provider: "Test fixture",
        source_kind: "fixture",
        model_version: "hannah-1.0.0",
        current: {
          time: "2026-09-15T14:15:00Z",
          wind: 7,
          direction: 90,
          gust: 12,
          temperature: 65,
          precipitation: 0,
          probability: 0,
          visibility: 16000,
          code: 2,
        },
        hours: [14, 15, 16].map((h) => ({
          time: `2026-09-15T${h}:00:00Z`,
          wind: 7,
          direction: 90,
          gust: 12,
          temperature: 65,
          precipitation: 0,
          probability: 0,
          visibility: 16000,
          code: 2,
        })),
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: "Wind from E (90°)", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".compass-bearing")).toHaveAttribute(
    "transform",
    "rotate(90 40 40)",
  );
  await expect(page.locator(".valid-time")).toHaveText(
    "Current estimate for 9:15 AM",
  );
  await expect(page.locator(".hour-row time")).toHaveText([
    "10:00 AM",
    "11:00 AM",
  ]);
  await page.clock.fastForward(37 * 60000);
  await expect(page.locator(".valid-time")).toHaveText(
    "Hourly estimate for 10:00 AM",
  );
  await expect(page.locator(".hour-row time")).toHaveText(["11:00 AM"]);
});
