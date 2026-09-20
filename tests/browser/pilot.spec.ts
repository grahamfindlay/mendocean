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
    page.getByRole("button", { name: "Scheduled rows", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page
    .getByRole("button", { name: "Scheduled rows", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sign in to forecast your rows" }),
  ).toBeVisible();
  await expect(
    page.getByText("Today and Week stay available without one."),
  ).toBeVisible();
  // Public forecasts remain reachable through the other forecast tabs.
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.locator(".day-picker button")).not.toHaveCount(0);
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
        {
          ...base,
          id: "logged",
          title: "Logged practice",
          attendance: "declined",
          reports: [{ outcome: "rowed", rating: 2, route: "east" }],
          starts_at: "2026-09-12T14:00:00Z",
          ends_at: "2026-09-12T15:30:00Z",
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
  await expect(page.locator('.row-card[aria-pressed="true"] h3')).toHaveText(
    "Tomorrow practice",
  );
  await expect(page.locator('.row-card[aria-pressed="true"]')).toContainText(
    "9:00 AM – 10:30 AM",
  );
  await expect(page.locator(".weather-chart")).toHaveCount(1);
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
  // R30. A practice the owner declined and never logged leaves the default
  // set; one they logged stays whatever BHC now says about attendance.
  await expect(page.locator(".outing-card h3")).toHaveText([
    "Recent practice",
    "Logged practice",
  ]);
  await expect(page.getByText("Not attending", { exact: true })).toBeVisible();
  // R28. The account-level reason is stated once for the list, and no card
  // carries a reminder sentence explaining a reminder it cannot have.
  await expect(
    page.getByText("Choose a logging reminder channel in Account first."),
  ).toHaveCount(1);
  await expect(page.locator(".outing-reminder")).toHaveCount(0);
  await expect(
    page.getByText("1 past practice you did not attend is hidden."),
  ).toBeVisible();
  await page.locator(".row-filters > summary").click();
  expect(
    (await page.locator(".filter-toggle").boundingBox())!.height,
  ).toBeLessThan(32);
  await page.getByRole("checkbox", { name: "Show all practices" }).check();
  await expect(page.locator(".outing-card h3")).toHaveText([
    "Recent practice",
    "Older practice",
    "Logged practice",
  ]);
  await expect(page.getByText("you did not attend")).toHaveCount(0);
  // The report filter composes with the default set rather than replacing it.
  await page.selectOption('label:has-text("Reports") select', "Unlogged");
  await expect(page.locator(".row-filters > summary")).toContainText(
    "Filters · 2",
  );
  await expect(page.locator(".outing-card h3")).toHaveText([
    "Recent practice",
    "Older practice",
  ]);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".row-filters > summary")).toHaveText("Filters");
  await expect(page.locator(".outing-card h3")).toHaveText([
    "Recent practice",
    "Logged practice",
  ]);
});

test("past rows mark logged, needs log and a report still on this device", async ({
  page,
  context,
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
          id: "done",
          title: "Logged practice",
          reports: [{ outcome: "rowed", rating: 2, route: "east" }],
          starts_at: "2026-09-14T14:00:00Z",
          ends_at: "2026-09-14T15:30:00Z",
        },
        {
          ...base,
          id: "todo",
          title: "Unlogged practice",
          starts_at: "2026-09-13T14:00:00Z",
          ends_at: "2026-09-13T15:30:00Z",
        },
      ]),
    );
  });
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "My rows", exact: true }).click();
  await page.getByRole("button", { name: "Past", exact: true }).click();
  const marks = page.locator(".log-status .log-mark");
  await expect(marks).toHaveText(["Logged", "Needs log"]);
  // Every mark names its state in words. Color alone would leave the three
  // indistinguishable to anyone who cannot separate them.
  await expect(page.locator(".log-logged svg")).toBeVisible();
  // R26. One primary action on the face of the card; the rest a tap away,
  // behind a summary that keeps a full touch target.
  const logged = page
    .locator(".outing-card")
    .filter({ hasText: "Logged practice" });
  await expect(
    logged.getByRole("button", { name: "Edit report" }),
  ).toBeVisible();
  await expect(logged.getByRole("button", { name: "Delete" })).toBeHidden();
  const more = logged.getByRole("button", { name: "More" });
  expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await more.click();
  await expect(logged.getByRole("button", { name: "Delete" })).toBeVisible();
  await page.getByRole("button", { name: "Log this row" }).click();
  await page
    .getByRole("button", { name: "Stayed ashore", exact: true })
    .click();
  await page.getByLabel("What kept you ashore?").selectOption("wind_waves");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(page.getByText("On this device · 1 pending")).toBeVisible();
  await page.getByRole("button", { name: "Past", exact: true }).click();
  // A report sitting in the outbox is neither logged nor waiting to be
  // written, and the row it belongs to says so rather than "Needs log".
  await expect(marks).toHaveText(["Logged", "Saved on this device"]);
  // Offering it again would stage a second report for the same row.
  await expect(page.getByRole("button", { name: "Log this row" })).toHaveCount(
    0,
  );
  // Reconnecting flushes the outbox on its own; the mark follows the upload.
  await context.setOffline(false);
  await expect(page.getByText("On this device · 1 pending")).toHaveCount(0);
  await page.getByRole("button", { name: "Past", exact: true }).click();
  await expect(marks).toHaveText(["Logged", "Logged"]);
});

test("upcoming filters narrow by type and attendance without hiding independent rows", async ({
  page,
}, testInfo) => {
  const viewport = testInfo.project.use.viewport!;
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
          id: "going",
          title: "Attending practice",
          starts_at: "2026-09-16T14:00:00Z",
          ends_at: "2026-09-16T15:30:00Z",
        },
        {
          ...base,
          id: "skipping",
          title: "Declined practice",
          attendance: "declined",
          starts_at: "2026-09-17T14:00:00Z",
          ends_at: "2026-09-17T15:30:00Z",
        },
        {
          ...base,
          id: "single",
          kind: "independent",
          bhc_practice_id: null,
          attendance: undefined,
          owner_id: "10000000-0000-4000-8000-000000000001",
          title: "Sunrise single",
          starts_at: "2026-09-18T11:00:00Z",
          ends_at: "2026-09-18T12:00:00Z",
        },
      ]),
    );
  });
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "My rows", exact: true }).click();
  const titles = page.locator(".outing-card h3");
  await expect(titles).toHaveText([
    "Attending practice",
    "Declined practice",
    "Sunrise single",
  ]);
  await page.locator(".row-filters > summary").click();
  // R29's trap, from the owner's seat: asking for rows they are attending must
  // not drop the row they scheduled themselves, which carries no BHC value.
  await page.selectOption('label:has-text("Attendance") select', "Attending");
  await expect(titles).toHaveText(["Attending practice", "Sunrise single"]);
  await page.selectOption(
    'label:has-text("Attendance") select',
    "Not attending",
  );
  await expect(titles).toHaveText(["Declined practice", "Sunrise single"]);
  // Attendance describes practices, so it is not offered once they are gone.
  await page.selectOption('label:has-text("Type") select', "Independent");
  await expect(titles).toHaveText(["Sunrise single"]);
  await expect(page.getByLabel("Attendance")).toHaveCount(0);
  await page.selectOption('label:has-text("Type") select', "Practices");
  await expect(titles).toHaveText(["Declined practice"]);
  await page.selectOption('label:has-text("Attendance") select', "Unknown");
  await expect(titles).toHaveCount(0);
  await expect(
    page.getByText("No upcoming rows match these filters."),
  ).toBeVisible();
  // The panel is open with every control showing: still no page-widening.
  expect(
    await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    })),
  ).toEqual({ docWidth: viewport.width, innerWidth: viewport.width });
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(titles).toHaveCount(3);
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
  await page.goto("/?tab=Today");
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
  await page.goto("/?tab=Today");
  await expect(page.locator(".sample-time time")).toContainText("9:15 AM");
  await expect(page.locator(".hour-row time").first()).toHaveText("9:30 AM");
  const chart = page.getByRole("region", {
    name: "Next 4 hours",
    exact: true,
  });
  await chart.getByRole("slider").press("ArrowRight");
  await expect(chart.locator(".chart-reading time")).toContainText("9:30 AM");
  await expect(chart.locator(".chart-reading")).toContainText("Gusts: 38 mph");
  await expect(chart.locator(".chart-overflow")).toHaveCount(0);
  await expect(chart.locator(".chart-surface")).toHaveAttribute(
    "data-wind-max",
    "40",
  );
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
  expect(readingBox!.y + readingBox!.height).toBeLessThanOrEqual(surfaceBox!.y);
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
    Number(await longChart.getByRole("slider").getAttribute("aria-valuenow")),
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
  await page.getByRole("button", { name: "Week", exact: true }).click();
  const cards = page.locator(".week-grid article");
  await expect(cards).toHaveCount(7);
  await expect(cards.first().locator(".practice-window")).toHaveCount(2);
  await expect(cards.first()).toContainText("Morning 5:30 AM–7:30 AM");
  await expect(cards.first()).toContainText("Evening 6:00 PM–8:00 PM");
  // A time range split across lines reads as two times; found on the live site.
  await expect(cards.first().locator(".window-time").first()).toHaveCSS(
    "white-space",
    "nowrap",
  );
  await cards.nth(1).getByRole("button").click();
  await expect(
    page.locator(".day-picker button[aria-pressed=true]"),
  ).toContainText("Sep 16");
  await page.getByRole("button", { name: "Later day" }).click();
  await expect(
    page.locator(".day-picker button[aria-pressed=true]"),
  ).toContainText("Sep 17");
  await page.getByRole("button", { name: "Earlier day" }).click();
  await page
    .getByRole("button", { name: "Scheduled rows", exact: true })
    .click();
  await expect(page.locator(".day-picker")).toHaveCount(0);
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
  // innerWidth is asserted too: content wider than the screen makes the phone
  // widen the layout viewport and zoom the page out, which would satisfy
  // scrollWidth <= innerWidth while rendering everything at a third size.
  expect(
    await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    })),
  ).toEqual({ docWidth: viewport.width, innerWidth: viewport.width });
});

test("touch scrubbing preserves vertical scrolling and releases a cancelled gesture", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "phone",
    "Touch input requires the phone project",
  );
  await page.goto("/?tab=Today");
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
  expect(
    Number(await chart.getByRole("slider").getAttribute("aria-valuenow")),
  ).toBeGreaterThan(2);
  await touch("touchCancel");
  // A fresh tap must work after cancellation instead of leaving the old pointer captured.
  await touch("touchStart", x, y);
  await touch("touchEnd");
  expect(
    Number(await chart.getByRole("slider").getAttribute("aria-valuenow")),
  ).toBeLessThan(2);
  const before = await page.evaluate(() => window.scrollY);
  await touch("touchStart", x, y + 80);
  for (let i = 1; i <= 8; i++) await touch("touchMove", x, y + 80 - i * 15);
  await touch("touchEnd");
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(before + 30);
  await client.detach();
});

test("a scheduled row is forecast over its own window, and scheduling is an explicit entry", async ({
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
    gust: 12,
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
  await page.addInitScript(() => {
    localStorage.setItem(
      "mendocean-explicit-preview-v1",
      JSON.stringify([
        {
          kind: "independent",
          version: 1,
          owner_id: null,
          bhc_practice_id: null,
          reminder: false,
          attendance: "attending",
          reports: [],
          planned_boat: null,
          id: "scheduled",
          title: "Morning row",
          starts_at: "2026-09-15T14:43:00Z",
          ends_at: "2026-09-15T14:44:00Z",
        },
      ]),
    );
  });
  await page.goto("/?preview=1");
  await page
    .getByRole("button", { name: "Scheduled rows", exact: true })
    .click();
  const card = page.locator(".row-card").first();
  await expect(card.locator("h3")).toHaveText("Morning row");
  await expect(card).toContainText("9:43 AM – 9:44 AM");
  // The card summarizes the whole scheduled window, not the start instant.
  await expect(card.locator(".wind-speed")).toContainText("7");
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".weather-chart")).toHaveCount(1);
  await expect(page.locator(".chart-reading time")).toHaveText("9:45 AM");
  await expect(
    page.locator("input[type=range], .sample-details, .hour-table, .day-nav"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Schedule independent row" }).first(),
  ).toBeVisible();
  // R22: the band marks the row's window without taking over inspection.
  // It shares the axes' scale function and the same frozen domain, so it
  // cannot drift against them; what is worth asserting is that it lands on
  // the right time and stays out of the way.
  const dayChart = page.getByRole("region", { name: /Sep 15$/ });
  const band = dayChart.locator(".chart-highlight");
  await expect(band).toHaveCount(1);
  await expect(band).toHaveCSS("pointer-events", "none");
  const placement = await band.evaluate((rect) => {
    const svg = rect.closest("svg")!;
    const width = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
    const plot = width - 8 - 30;
    const box = rect.getBoundingClientRect();
    const surface = svg.getBoundingClientRect();
    const scale = width / surface.width;
    return {
      // Where the band starts, as a fraction of the plotted day.
      fraction: ((box.x - surface.x) * scale - 8) / plot,
      widthFraction: (box.width * scale) / plot,
    };
  });
  // 9:43 AM is 40.5% through a Madison calendar day.
  expect(placement.fraction).toBeGreaterThan(0.39);
  expect(placement.fraction).toBeLessThan(0.42);
  // One minute of a 24-hour day is a sliver, not a block.
  expect(placement.widthFraction).toBeLessThan(0.02);
  // Scrubbing still inspects samples: the band did not take the gesture.
  const surface = dayChart.locator(".chart-surface");
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 40, box.y + 80, { steps: 6 });
  await page.mouse.up();
  await expect(dayChart.locator(".chart-reading time")).not.toHaveText("");
  await expect(
    page.getByRole("checkbox", { name: "Show this row on the day chart" }),
  ).toHaveCount(0);
  await expect(band).toHaveCount(1);
});

test("scheduled filters, card-driven days, and accessible full-day inspection", async ({
  page,
}, testInfo) => {
  const now = Date.parse("2026-09-20T12:00:00Z");
  await page.clock.install({ time: now });
  await page.addInitScript(() => {
    const base = {
      kind: "official",
      version: 1,
      owner_id: null,
      bhc_practice_id: 1,
      reminder: false,
      reports: [],
      planned_boat: null,
    };
    localStorage.setItem(
      "mendocean-explicit-preview-v1",
      JSON.stringify([
        {
          ...base,
          id: "a",
          title: "Master Novice & Recreational",
          attendance: "attending",
          starts_at: "2026-09-21T10:30:00Z",
          ends_at: "2026-09-21T12:00:00Z",
        },
        {
          ...base,
          id: "b",
          title: "Unknown practice",
          attendance: "unknown",
          starts_at: "2026-09-22T10:30:00Z",
          ends_at: "2026-09-22T12:00:00Z",
        },
        {
          ...base,
          id: "c",
          title: "Declined practice",
          attendance: "declined",
          starts_at: "2026-09-23T10:30:00Z",
          ends_at: "2026-09-23T12:00:00Z",
        },
        {
          ...base,
          kind: "independent",
          id: "d",
          title: "Independent afternoon",
          starts_at: "2026-09-21T18:00:00Z",
          ends_at: "2026-09-21T19:00:00Z",
        },
        {
          ...base,
          kind: "independent",
          id: "e",
          title: "Beyond forecast",
          starts_at: "2026-10-21T18:00:00Z",
          ends_at: "2026-10-21T19:00:00Z",
        },
      ]),
    );
  });
  // Full local days with null fine-resolution probability: hourly data must survive.
  const base = Date.parse("2026-09-20T05:00:00Z");
  const sample = (time: number, fine = false) => ({
    time: new Date(time).toISOString(),
    wind: 8,
    gust: 44,
    direction: 45,
    temperature: 54,
    probability: fine ? null : 19,
    precipitation: 0,
    code: 3,
    visibility: null,
    interval_minutes: fine ? 15 : 60,
  });
  await page.route("**/api/weather", (route) =>
    route.fulfill({
      json: {
        fetched_at: new Date(now).toISOString(),
        provider: "Fixture",
        model_version: "hannah-1.0.0",
        hours: Array.from({ length: 169 }, (_, i) =>
          sample(base + i * 3600000),
        ),
        quarter_hours: Array.from({ length: 193 }, (_, i) =>
          sample(base + i * 900000, true),
        ),
      },
    }),
  );
  await page.goto("/?preview=1");
  await expect(
    page.getByRole("button", { name: "Scheduled rows", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const cards = page.locator(".row-card");
  await expect(cards).toHaveCount(3);
  expect(
    (await page.locator(".attendance-filters label").first().boundingBox())!
      .height,
  ).toBeLessThan(32);
  await expect(
    page.getByRole("checkbox", { name: "Attending", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Unknown", exact: true }),
  ).not.toBeChecked();
  await expect(cards.first()).toContainText("5:30 AM – 7:00 AM");
  await expect(cards.first()).toContainText("54°F • Overcast • 19% rain");
  const typography = await cards
    .first()
    .locator(".row-meta")
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const s = getComputedStyle(n);
        return [s.fontSize, s.fontWeight, s.color].join("|");
      }),
    );
  expect(new Set(typography).size).toBe(1);
  await expect(page.locator(".chart-date")).toHaveText("Mon, Sep 21");
  await expect(page.locator(".chart-reading time")).toHaveText("5:30 AM");
  await expect(page.locator(".chart-reading")).toContainText("19% rain");
  await expect(page.locator(".chart-probability-interval")).toHaveCount(24);
  await expect(page.locator(".chart-surface")).toHaveAttribute(
    "data-wind-max",
    "50",
  );
  await expect(page.locator(".chart-legend")).toHaveCount(0);
  await expect(page.locator(".chart-surface")).toContainText("Wind • mph");
  await expect(page.locator(".chart-wind-rule text")).toHaveText([
    "0",
    "10",
    "20",
    "30",
    "40",
    "50",
  ]);
  const reading = await page.locator(".chart-reading").boundingBox();
  expect(reading!.height).toBeLessThan(115);
  await expect
    .poll(() =>
      page.locator(".weather-chart").evaluate((chart) => {
        const reading = chart
          .querySelector(".chart-reading")!
          .getBoundingClientRect();
        return (
          chart.querySelector(".chart-surface")!.getBoundingClientRect().top -
          reading.bottom
        );
      }),
    )
    .toBeLessThan(8);
  await expect(page.locator(".chart-surface .wind-vector")).toHaveCount(24);
  await cards.filter({ hasText: "Independent afternoon" }).click();
  await expect(page.locator(".chart-reading time")).toHaveText("1:00 PM");
  await page.getByRole("slider", { name: "Forecast time" }).press("ArrowRight");
  await expect(page.locator(".chart-reading time")).toHaveText("1:15 PM");
  await expect(page.locator(".chart-highlight")).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Unknown", exact: true }).check();
  await cards.filter({ hasText: "Unknown practice" }).click();
  await expect(page.locator(".chart-date")).toHaveText("Tue, Sep 22");
  await page.getByRole("checkbox", { name: "Unknown", exact: true }).uncheck();
  await expect(cards.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".chart-date")).toHaveText("Mon, Sep 21");
  await page
    .getByRole("checkbox", { name: "Attending", exact: true })
    .uncheck();
  await expect(cards).toHaveCount(0);
  await expect(page.locator(".weather-chart")).toHaveCount(0);
  await expect(page.getByText("No rows match these filters")).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Not attending", exact: true })
    .check();
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page
    .getByRole("button", { name: "Scheduled rows", exact: true })
    .click();
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "My rows", exact: true }).click();
  await page.getByRole("button", { name: "Forecasts", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "My rows", exact: true }).click();
  await page
    .locator(".outing-card")
    .filter({ hasText: "Unknown practice" })
    .getByRole("button", { name: "View forecast", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Unknown", exact: true }),
  ).toBeChecked();
  await expect(cards.filter({ hasText: "Unknown practice" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("checkbox", { name: "Unknown", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Attending", exact: true }).check();
  await cards.filter({ hasText: "Beyond forecast" }).click();
  await expect(page.locator(".weather-chart")).toContainText(
    "Forecast samples unavailable.",
  );
  await expect(page.locator(".weather-chart")).toContainText("Oct 21");
  await cards.first().click();
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
    if (width >= 375 && width <= 430) {
      await expect
        .poll(
          async () =>
            Number(
              await page
                .locator(".chart-surface")
                .getAttribute("data-plot-width"),
            ) / width,
        )
        .toBeGreaterThanOrEqual(0.85);
    }
    await page.screenshot({
      path: `/tmp/mendocean-scheduled-${testInfo.project.name}-${width}.png`,
      fullPage: true,
    });
  }
});
