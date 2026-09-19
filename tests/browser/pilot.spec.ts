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
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rows", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Window", exact: true })
    .selectOption("1");
  await expect(
    page.getByText("Samples at or around the selected time"),
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
  await page.clock.install({ time: now - 1000 });
  await page.clock.pauseAt(now);
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
  await page.getByRole("button", { name: "My rows", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tomorrow practice" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Log this row" })).toHaveCount(
    0,
  );
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
    .getByRole("combobox", { name: "Which row?" })
    .locator("option");
  await expect(options).toHaveText([
    "＋ Independent / unofficial row",
    /Recent practice/,
    /Older practice/,
  ]);
  await page.getByRole("button", { name: "My rows", exact: true }).click();
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
  await expect(page.locator(".sample-time time")).toContainText("9:15 AM");
  await expect(page.locator(".hour-row time")).toHaveText([
    "10:00 AM",
    "11:00 AM",
  ]);
  await page.clock.fastForward(37 * 60000);
  await expect(page.locator(".sample-time time")).toContainText("10:00 AM");
  await expect(page.locator(".hour-row time")).toHaveText(["11:00 AM"]);
});

test("quarter-hour charts inspect real samples and preserve minute-specific forecasts", async ({
  page,
}) => {
  const now = Date.parse("2026-09-15T14:24:00Z"),
    base = Date.parse("2026-09-15T14:00:00Z");
  await page.clock.install({ time: now - 1000 });
  await page.clock.pauseAt(now);
  const row = (time: number, interval: number) => ({
    time: new Date(time).toISOString(),
    interval_minutes: interval,
    wind: 7,
    direction: 350,
    gust: time === base + 1800000 ? 38 : 12,
    temperature: 65,
    precipitation: 0.1,
    probability: interval === 60 ? 30 : null,
    visibility: null,
    code: 2,
  });
  await page.route("**/api/weather", (r) =>
    r.fulfill({
      json: {
        fetched_at: new Date(now).toISOString(),
        provider: "Test fixture",
        source_kind: "fixture",
        model_version: "hannah-1.0.0",
        current: null,
        hours: Array.from({ length: 168 }, (_, i) =>
          row(base + i * 3600000, 60),
        ),
        quarter_hours: Array.from({ length: 192 }, (_, i) =>
          row(base + i * 900000, 15),
        ),
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator(".sample-time time")).toContainText("9:15 AM");
  await expect(page.locator(".hour-row time").first()).toHaveText("9:30 AM");
  const chart = page.getByRole("region", {
    name: "Next 4 hours",
    exact: true,
  });
  await chart.getByRole("slider").press("ArrowRight");
  await expect(chart.locator(".chart-reading time")).toContainText("9:30 AM");
  await expect(chart.locator(".chart-reading")).toContainText("G38");
  await expect(chart.locator(".chart-overflow")).toHaveCount(1);
  await expect(chart.locator(".chart-overflow title")).toContainText("38 mph");
  await expect(chart.locator(".wind-vector")).toHaveCount(16);
  await expect(chart.locator(".weather-icon")).toHaveCount(8);
  const vector = chart.locator(".wind-vector").first();
  await expect(vector).toHaveAttribute("width", "32");
  await expect(vector.locator("g")).toHaveAttribute(
    "transform",
    "rotate(350 16 16)",
  );
  await expect(chart.locator(".chart-reading")).not.toContainText(
    "Precipitation",
  );
  await expect(page.locator(".current-panel .rain-chance")).toContainText(
    "30%",
  );
  await expect(
    page
      .getByRole("region", { name: "All day", exact: true })
      .locator(".chart-reading time"),
  ).toContainText("9:15 AM");
  expect(await page.locator(".hour-row time").allTextContents()).toEqual(
    Array.from({ length: 12 }, (_, i) => {
      const t = new Date(base + (i + 1) * 1800000);
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        hour: "numeric",
        minute: "2-digit",
      }).format(t);
    }),
  );
  await expect(chart.locator(".chart-surface")).toHaveAttribute(
    "data-domain-start",
    String(now),
  );
  await expect(chart.locator(".chart-surface")).toHaveAttribute(
    "data-domain-end",
    String(now + 4 * 3600000),
  );
  const readingBox = await chart.locator(".chart-reading").boundingBox();
  const surfaceBox = await chart.locator(".chart-surface").boundingBox();
  expect(readingBox!.y + readingBox!.height).toBeLessThan(surfaceBox!.y);
  await page.getByLabel("Hours ahead").selectOption("24");
  const longChart = page.getByRole("region", {
    name: "Next 24 hours",
    exact: true,
  });
  await expect(longChart.locator(".chart-surface")).toHaveAttribute(
    "data-domain-end",
    String(now + 24 * 3600000),
  );
  expect(
    Number(
      await longChart
        .locator(".chart-surface")
        .getAttribute("data-sample-count"),
    ),
  ).toBeGreaterThan(90);
  expect(
    await longChart.locator(".chart-annotation").count(),
  ).toBeGreaterThanOrEqual(12);
  expect(
    await longChart.locator(".weather-icon").count(),
  ).toBeGreaterThanOrEqual(12);
  await expect(longChart.locator(".wind-vector")).toHaveCount(24);
  // Narrow screens shrink annotations instead of letting them collide.
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: viewport.height });
  await expect
    .poll(() =>
      longChart
        .locator(".weather-icon")
        .evaluateAll((icons) =>
          icons
            .map((icon) => icon.getBoundingClientRect())
            .every(
              (box, i, boxes) => i === 0 || box.left >= boxes[i - 1].right,
            ),
        ),
    )
    .toBe(true);
  await page.setViewportSize(viewport);
  await longChart.scrollIntoViewIfNeeded();
  const bounds = (await longChart.locator(".chart-surface").boundingBox())!;
  await page.mouse.move(bounds.x + 60, bounds.y + 80);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 30, bounds.y + 80, {
    steps: 8,
  });
  expect(
    Number(await longChart.getByRole("slider").inputValue()),
  ).toBeGreaterThan(60);
  await page.clock.fastForward(60000);
  await expect(longChart.locator(".chart-surface")).toHaveAttribute(
    "data-domain-start",
    String(now),
  );
  await page.mouse.up();
  await expect(longChart.locator(".chart-surface")).toHaveAttribute(
    "data-domain-start",
    String(now + 60000),
  );
  await page.getByRole("button", { name: "Rows", exact: true }).click();
  await page.getByLabel("Start time · Madison").fill("2026-09-15T09:43");
  await page
    .getByRole("combobox", { name: "Window", exact: true })
    .selectOption("1");
  const selectedChart = page.getByRole("region", {
    name: "Selected forecast",
    exact: true,
  });
  await expect(selectedChart.locator(".chart-reading time")).toContainText(
    "9:30 AM",
  );
  await selectedChart.getByRole("slider").press("End");
  await expect(selectedChart.locator(".chart-reading time")).toContainText(
    "9:45 AM",
  );
  await expect(
    page.getByRole("heading", { name: "Five days at 09:43" }),
  ).toBeVisible();
  await page.locator(".comparison-grid button").nth(1).click();
  await expect(
    page.locator(".day-picker button[aria-pressed=true]"),
  ).toContainText("Sep 16");
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(
    page.locator(".day-picker button[aria-pressed=true]"),
  ).toContainText("Sep 16");
  await page
    .getByText("Detailed forecast for this day", { exact: true })
    .click();
  const dailyTimes = await page
    .locator(".sample-details .hour-row time")
    .allTextContents();
  expect(dailyTimes.length).toBe(48);
  expect(dailyTimes.every((time) => /:(00|30) [AP]M$/.test(time))).toBe(true);
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("touch scrubbing preserves vertical scrolling and releases a cancelled gesture", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "phone",
    "Touch input requires the phone project",
  );
  await page.goto("/");
  const chart = page.getByRole("region", { name: "Next 4 hours", exact: true });
  const surface = chart.locator(".chart-surface");
  await surface.scrollIntoViewIfNeeded();
  const bounds = (await surface.boundingBox())!;
  const client = await context.newCDPSession(page);
  const touch = async (
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    x = 0,
    y = 0,
  ) => {
    await client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y, id: 1 }],
    });
  };
  const x = bounds.x + 65,
    y = bounds.y + 100;
  await touch("touchStart", x, y);
  for (let i = 1; i <= 6; i++)
    await touch("touchMove", x + ((bounds.width - 95) * i) / 6, y);
  expect(Number(await chart.getByRole("slider").inputValue())).toBeGreaterThan(
    2,
  );
  await touch("touchCancel");
  // A fresh tap must work after cancellation instead of leaving the old pointer captured.
  await touch("touchStart", x, y);
  await touch("touchEnd");
  expect(Number(await chart.getByRole("slider").inputValue())).toBeLessThan(2);
  const before = await page.evaluate(() => window.scrollY);
  await touch("touchStart", x, y + 80);
  for (let i = 1; i <= 8; i++) await touch("touchMove", x, y + 80 - i * 15);
  await touch("touchEnd");
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(before + 30);
  await client.detach();
});
