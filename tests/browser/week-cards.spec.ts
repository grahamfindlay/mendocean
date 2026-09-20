import { test, expect } from "@playwright/test";

const now = Date.parse("2026-09-20T05:00:00Z");
const defaults = [
  {
    id: "morning",
    label: "Early morning",
    start: "05:30",
    end: "07:00",
    enabled: true,
    days: [0, 1, 2, 3, 4, 5, 6],
  },
  {
    id: "evening",
    label: "Evening",
    start: "18:00",
    end: "19:30",
    enabled: true,
    days: [0, 1, 2, 3, 4, 5, 6],
  },
];

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(now) });
  await page.route("**/api/weather", (route) =>
    route.fulfill({
      json: {
        fetched_at: new Date(now).toISOString(),
        provider: "Test fixture",
        source_kind: "fixture",
        model_version: "hannah-1.0.0",
        current: null,
        hours: Array.from({ length: 192 }, (_, i) => ({
          time: new Date(now + i * 3600000).toISOString(),
          wind: 7,
          direction: 45,
          gust: 12,
          temperature: 65,
          precipitation: 0,
          probability: 20,
          visibility: 16000,
          code: 2,
        })),
      },
    }),
  );
});

test("two periods share mobile headings and retain accessible wind and weather summaries", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?tab=Week");
  const cards = page.locator(".week-card");
  await expect(cards).toHaveCount(7);
  await expect(page.locator(".week-period-headings")).toBeVisible();
  await expect(cards.first()).toHaveAccessibleName(
    /Early morning 5:30 AM – 7:00 AM/,
  );
  await expect(
    cards.first().getByRole("img", { name: "Wind from NE", exact: true }),
  ).toHaveCount(2);
  await expect(
    cards.first().locator('svg[aria-label="Wind from NE"] path').first(),
  ).toHaveAttribute("transform", "rotate(45 12 12)");
  await expect(cards.first()).toContainText("G12 • from NE");
  await expect(
    cards.first().getByRole("img", { name: "Partly cloudy", exact: true }),
  ).toHaveCount(2);
  await expect(cards.first()).toContainText("65°F");
  await expect(cards.first()).not.toContainText("% rain");
  expect((await cards.first().boundingBox())!.height).toBeLessThanOrEqual(70);
  // Leave room for app navigation and browser chrome on a typical phone.
  expect(
    (await page.locator(".week-grid").boundingBox())!.height,
  ).toBeLessThanOrEqual(530);
  await cards.nth(3).click();
  await expect(cards.nth(3)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".day-picker")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Wed, Sep 23", exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("week-two-periods.png"),
    fullPage: true,
  });
});

test("additional periods wrap in pairs, including long names on narrow phones", async ({
  page,
}, testInfo) => {
  const periods = [
    ...defaults,
    {
      ...defaults[0],
      id: "lunch",
      label: "Lunch",
      start: "12:00",
      end: "13:00",
    },
    {
      ...defaults[0],
      id: "afternoon",
      label: "Afternoon",
      start: "15:00",
      end: "16:30",
    },
  ];
  await page.addInitScript((periods) => {
    if (!localStorage.getItem("mendocean-week-periods-v2")) {
      localStorage.setItem(
        "mendocean-week-periods-v2",
        JSON.stringify(periods),
      );
    }
  }, periods);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?tab=Week");
  await expect(page.locator(".week-period-headings")).toHaveCount(0);
  const periodsInCard = page
    .locator(".week-card")
    .first()
    .locator(".practice-window");
  await expect(periodsInCard).toHaveCount(4);
  const boxes = await periodsInCard.evaluateAll((elements) =>
    elements.map((e) => ({
      x: e.getBoundingClientRect().x,
      y: e.getBoundingClientRect().y,
    })),
  );
  expect(boxes[0].y).toBe(boxes[1].y);
  expect(boxes[2].y).toBe(boxes[3].y);
  expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
  expect(boxes[0].x).toBe(boxes[2].x);
  await page.screenshot({
    path: testInfo.outputPath("week-four-periods.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => {
    const periods = JSON.parse(
      localStorage.getItem("mendocean-week-periods-v2")!,
    );
    periods[0].label = "Averylongunbrokenperiodnamefornarrowphones".slice(
      0,
      40,
    );
    localStorage.setItem(
      "mendocean-week-periods-v2",
      JSON.stringify(periods.slice(0, 3)),
    );
  });
  await page.reload();
  await expect(periodsInCard).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await periodsInCard.evaluateAll((elements) =>
      elements.every((e) => e.scrollWidth <= e.clientWidth),
    ),
  ).toBe(true);
});

test("day chart marks enabled weekday periods and keeps scrubbing independent", async ({
  page,
}, testInfo) => {
  await page.addInitScript((periods) => {
    localStorage.setItem(
      "mendocean-week-periods-v2",
      JSON.stringify([
        periods[0],
        { ...periods[1], days: [0] },
        {
          ...periods[0],
          id: "overlap",
          label: "Second session",
          start: "06:00",
          end: "08:00",
        },
        {
          ...periods[0],
          id: "disabled",
          label: "Disabled session",
          enabled: false,
        },
      ]),
    );
  }, defaults);
  await page.goto("/?tab=Week");
  await expect(page.locator(".weather-chart")).toHaveCount(0);
  await page.locator(".week-card").first().click();
  const bands = page.locator(".chart-period-highlight");
  await expect(bands).toHaveCount(2);
  await expect(page.locator(".chart-window-key")).toHaveCount(0);
  await expect(bands.first()).toHaveAttribute(
    "data-start",
    String(Date.parse("2026-09-20T10:30:00Z")),
  );
  await expect(bands.first()).toHaveAttribute(
    "data-end",
    String(Date.parse("2026-09-20T12:00:00Z")),
  );
  await expect(bands.first()).toHaveCSS("pointer-events", "none");
  const surface = page.locator(".chart-surface");
  const geometry = await surface.evaluate((e) => {
    const band = e.querySelector(".chart-period-highlight")!;
    return {
      x: Number(band.getAttribute("x")),
      width: Number(band.getAttribute("width")),
      plot: Number(e.getAttribute("data-plot-width")),
    };
  });
  expect(geometry.x).toBeCloseTo(8 + (geometry.plot * 5.5) / 24, 1);
  expect(geometry.width).toBeCloseTo((geometry.plot * 1.5) / 24, 1);
  await surface.focus();
  await page.keyboard.press("End");
  const inspected = await surface.getAttribute("aria-valuenow");
  await expect(bands).toHaveCount(2);
  await page.getByText("Times of interest", { exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Second session", exact: true })
    .uncheck();
  await expect(bands).toHaveCount(1);
  await expect(surface).toHaveAttribute("aria-valuenow", inspected!);
  await page.locator(".week-card").nth(1).click();
  await expect(bands).toHaveCount(2);
  await expect(page.locator(".chart-window-key")).toHaveCount(0);
  await expect(bands.first()).toHaveAttribute(
    "data-start",
    String(Date.parse("2026-09-21T10:30:00Z")),
  );
  await page
    .getByRole("checkbox", { name: "Early morning", exact: true })
    .uncheck();
  await page.getByRole("checkbox", { name: "Evening", exact: true }).uncheck();
  await expect(bands).toHaveCount(0);
  await expect(page.locator(".chart-window-key")).toHaveCount(0);
  await expect(surface).toBeVisible();
  await expect(
    page.getByText("Detailed forecast for this day", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Early morning", exact: true })
    .check();
  await page.getByRole("checkbox", { name: "Evening", exact: true }).check();
  await page.getByText("Times of interest", { exact: true }).click();
  await page
    .locator(".weather-chart")
    .screenshot({ path: testInfo.outputPath("week-period-chart.png") });
});
