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
    page.getByRole("button", { name: "Today", exact: true }),
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
test("independent report requires a boat, allows optional classes, and hides coaching", async ({
  page,
}) => {
  await page.goto("/?preview=1");
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await page.getByRole("button", { name: "2 Good", exact: true }).click();
  await page.getByRole("button", { name: "East", exact: true }).click();
  await expect(page.getByText("Your reports help build better wind-wave models and rowing forecasts.")).toBeVisible();
  await expect(page.getByText("A SMALL EFFORT. A BETTER FORECAST.")).toHaveCount(0);
  const boat = page.getByRole("combobox", { name: "Your boat", exact: true });
  await expect(boat).toBeVisible();
  await expect(boat).toHaveAttribute("required", "");
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(boat).toBeFocused();
  await boat.selectOption("1x");
  await expect(page.getByRole("group", { name: "Boat classes that actually went out (optional)", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Coaching", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(page.getByText("2 · Good · east")).toBeVisible();
  // Existing coach metadata remains attached when editing without coach controls.
  await page.evaluate(() => {
    const key = "mendocean-explicit-preview-v1";
    const outings = JSON.parse(localStorage.getItem(key)!);
    Object.assign(outings[0].reports[0], {
      coach_state: "known",
      coach_ids: ["30000000-0000-4000-8000-000000000001"],
      coach_count: 1,
    });
    outings[0].planned_coaches = ["Charlie"];
    localStorage.setItem(key, JSON.stringify(outings));
  });
  await page.reload();
  await page.getByRole("button", { name: "My rows", exact: true }).click();
  await page.getByRole("button", { name: "Past", exact: true }).click();
  await page.getByRole("button", { name: "Edit report", exact: true }).click();
  await page.getByRole("button", { name: "5 Forced off", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Your boat", exact: true })
    .selectOption("2x");
  await page.getByRole("button", { name: "4x", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("5 · Forced off · east")).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mendocean-explicit-preview-v1")!)[0]);
  expect(saved.reports[0]).toMatchObject({ boat_class: "2x", launched_boats: ["4x"], coach_state: "known", coach_ids: ["30000000-0000-4000-8000-000000000001"], coach_count: 1 });
  expect(saved.planned_coaches).toEqual(["Charlie"]);
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
  ).toBeLessThanOrEqual(32);
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

test("wind bearing indicates source direction and Now updates with the current sample", async ({
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
          wind: h === 15 ? 9 : 7,
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
  await expect(page.locator(".now-panel details")).toHaveCount(0);
  await expect(page.locator(".weather-chart .chart-date")).toHaveCount(0);
  await expect(page.locator(".hour-row")).toHaveCount(0);
  await page.clock.fastForward(37 * 60000);
  await expect(page.locator(".now-wind")).toContainText("9.0 mph");
  await expect(page.locator(".hour-row")).toHaveCount(0);
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
  await expect(page.locator(".now-panel details")).toHaveCount(0);
  await expect(page.locator(".weather-chart .chart-date")).toHaveCount(0);
  const chart = page.getByRole("region", { name: "All day", exact: true });
  await expect(
    page.getByRole("heading", { name: "Now", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".weather-chart")).toHaveCount(1);
  await expect(
    page.locator(
      ".hour-table, .horizon-picker, .log-callout, .today-scheduled",
    ),
  ).toHaveCount(0);
  await expect(chart.locator(".chart-now-marker")).toHaveAttribute(
    "data-time",
    String(now),
  );
  const nowX = await chart.locator(".chart-now").getAttribute("x1");
  await chart.getByRole("slider").press("ArrowRight");
  await expect(chart.locator(".chart-reading time")).toContainText("9:30 AM");
  await expect(chart.locator(".chart-reading")).toContainText("Gusts: 38 mph");
  await expect(chart.locator(".chart-now")).toHaveAttribute("x1", nowX!);
  await expect(chart.locator(".chart-surface")).toHaveAttribute(
    "data-wind-max",
    "40",
  );
  await expect(page.locator(".now-panel .rain-chance")).toContainText("30%");
  await expect(chart.locator(".chart-surface")).toHaveAttribute(
    "data-domain-start",
    String(Date.parse("2026-09-15T05:00:00Z")),
  );
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: viewport.height });
  await expect
    .poll(() =>
      chart
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
  await chart.scrollIntoViewIfNeeded();
  const bounds = (await chart.locator(".chart-surface").boundingBox())!;
  await page.mouse.move(bounds.x + 60, bounds.y + 80);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 30, bounds.y + 80, {
    steps: 8,
  });
  expect(
    Number(await chart.getByRole("slider").getAttribute("aria-valuenow")),
  ).toBeGreaterThan(30);
  const inspected = await chart.locator(".chart-reading time").textContent();
  await page.clock.fastForward(60000);
  await expect(chart.locator(".chart-now-marker")).toHaveAttribute(
    "data-time",
    String(now + 60000),
  );
  await expect(chart.locator(".chart-reading time")).toHaveText(inspected!);
  await page.mouse.up();
  await expect(chart.locator(".chart-surface")).toHaveAttribute(
    "data-domain-start",
    String(Date.parse("2026-09-15T05:00:00Z")),
  );
  await page.getByRole("button", { name: "Week", exact: true }).click();
  const cards = page.locator(".week-grid article");
  await expect(cards).toHaveCount(7);
  if (page.viewportSize()!.width <= 600) {
    await expect.poll(async () => {
      const grid = await page.locator(".week-grid").boundingBox();
      const card = await cards.first().boundingBox();
      return Math.abs(grid!.width - card!.width);
    }).toBeLessThan(1);
  }
  await expect(cards.first().locator(".practice-window")).toHaveCount(2);
  await expect(cards.first()).toContainText("Early morning 5:30 AM – 7:00 AM");
  await expect(cards.first()).toContainText("Evening 6:00 PM – 7:30 PM");
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
  await expect(page.getByText("Detailed forecast for this day", { exact: true })).toHaveCount(0);
  await expect(page.locator(".chart-period-highlight")).toHaveCount(2);
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
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto("/?tab=Today");
  const chart = page.getByRole("region", { name: "All day", exact: true });
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
  const firstTap = await chart
    .getByRole("slider")
    .getAttribute("aria-valuenow");
  for (let i = 1; i <= 6; i++)
    await touch("touchMove", x + ((bounds.width - 95) * i) / 6, y);
  expect(
    Number(await chart.getByRole("slider").getAttribute("aria-valuenow")),
  ).toBeGreaterThan(2);
  await touch("touchCancel");
  // A fresh tap must work after cancellation instead of leaving the old pointer captured.
  await touch("touchStart", x, y);
  await touch("touchEnd");
  await expect(chart.getByRole("slider")).toHaveAttribute(
    "aria-valuenow",
    firstTap!,
  );
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
  await page.goto("/?preview=1&tab=Rows");
  await expect(
    page.getByRole("button", { name: "Scheduled rows", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const cards = page.locator(".row-card");
  await expect(cards).toHaveCount(3);
  expect(
    (await page.locator(".attendance-filters label").first().boundingBox())!
      .height,
  ).toBeLessThanOrEqual(32);
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
  await expect(
    page.getByRole("button", { name: "Today", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page
    .getByRole("button", { name: "Scheduled rows", exact: true })
    .click();
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
    if (width <= 430) {
      const cardTop = await cards.first().evaluate((card) => {
        // CI displays a development-only setup notice; it is absent in production.
        const previewNotice =
          document.querySelector(".setup-note")?.getBoundingClientRect()
            .height || 0;
        return (
          card.getBoundingClientRect().top + window.scrollY - previewNotice
        );
      });
      expect(cardTop).toBeLessThan(260);
    }
    await page.screenshot({
      path: `/tmp/mendocean-scheduled-${testInfo.project.name}-${width}.png`,
      fullPage: true,
    });
  }
});

test("Today shows only today's rows and keeps its chart and clock marker without matches or weather", async ({
  page,
}, testInfo) => {
  const now = Date.parse("2026-09-20T15:24:00Z");
  const start = Date.parse("2026-09-20T05:00:00Z");
  await page.clock.install({ time: now - 1000 });
  await page.clock.pauseAt(now);
  await page.route("**/api/weather", (route) =>
    route.fulfill({
      json: {
        fetched_at: new Date(now).toISOString(),
        provider: "Fixture",
        model_version: "hannah-1.0.0",
        hours: Array.from({ length: 25 }, (_, i) => ({
          time: new Date(start + i * 3600000).toISOString(),
          wind: 8,
          direction: 45,
          gust: 14,
          temperature: 54,
          code: 3,
          probability: 19,
          precipitation: 0,
          visibility: null,
        })),
      },
    }),
  );
  await page.addInitScript(() => {
    const common = {
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
          ...common,
          id: "early",
          title: "Earlier today",
          attendance: "attending",
          starts_at: "2026-09-20T10:30:00Z",
          ends_at: "2026-09-20T12:00:00Z",
        },
        {
          ...common,
          id: "late",
          title: "Later today",
          attendance: "unknown",
          starts_at: "2026-09-20T22:00:00Z",
          ends_at: "2026-09-20T23:00:00Z",
        },
        {
          ...common,
          id: "tomorrow",
          title: "Tomorrow only",
          attendance: "attending",
          starts_at: "2026-09-21T10:30:00Z",
          ends_at: "2026-09-21T12:00:00Z",
        },
      ]),
    );
  });
  await page.goto("/?preview=1&tab=Today");
  await expect(
    page.getByRole("heading", { name: "Now", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".row-card")).toHaveCount(1);
  await expect(page.locator(".row-card")).toContainText("Earlier today");
  await expect(page.getByText("Tomorrow only")).toHaveCount(0);
  await expect(page.locator(".weather-chart")).toHaveCount(1);
  const surface = page.locator(".chart-surface");
  const domainStart = await surface.getAttribute("data-domain-start");
  await expect(page.locator(".chart-highlight")).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Unknown", exact: true }).check();
  await page.locator(".row-card").filter({ hasText: "Later today" }).click();
  await expect(page.locator(".chart-highlight title")).toContainText("5:00 PM");
  const nowX = await page.locator(".chart-now").getAttribute("x1");
  await page.getByRole("slider").press("End");
  await expect(page.locator(".chart-now")).toHaveAttribute("x1", nowX!);
  await expect(surface).toHaveAttribute("data-domain-start", domainStart!);
  await page.getByRole("checkbox", { name: "Unknown", exact: true }).uncheck();
  await page
    .getByRole("checkbox", { name: "Attending", exact: true })
    .uncheck();
  await expect(page.locator(".row-card, .chart-highlight")).toHaveCount(0);
  await expect(page.getByText(/No rows match|No rows scheduled/)).toHaveCount(
    0,
  );
  await expect(page.locator(".chart-now-marker")).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Attending", exact: true }).check();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
    expect(
      (await page.locator(".now-panel").boundingBox())!.height,
    ).toBeLessThan(190);
    await page.screenshot({
      path: `/tmp/mendocean-today-${testInfo.project.name}-${width}.png`,
      fullPage: true,
    });
  }
  // Clear the preview rows after initialization, without reseeding on reload.
  await page.evaluate(() =>
    localStorage.setItem("mendocean-explicit-preview-v1", "[]"),
  );
  // Remove the init script by using a fresh page in this context; stored rows remain empty.
  const emptyPage = await page.context().newPage();
  await emptyPage.clock.install({ time: now - 1000 });
  await emptyPage.clock.pauseAt(now);
  await emptyPage.route("**/api/weather", (route) =>
    route.fulfill({
      json: {
        fetched_at: new Date(now).toISOString(),
        provider: "Fixture",
        model_version: "hannah-1.0.0",
        hours: [],
      },
    }),
  );
  await emptyPage.goto("/?preview=1&tab=Today");
  await expect(emptyPage.locator(".today-scheduled")).toHaveCount(0);
  await expect(emptyPage.locator(".weather-chart")).toHaveCount(1);
  await expect(emptyPage.locator(".chart-now-marker")).toHaveCount(1);
  await expect(emptyPage.locator(".weather-chart")).toContainText(
    "Forecast samples unavailable.",
  );
  await expect(emptyPage.locator(".hour-table, .horizon-picker")).toHaveCount(
    0,
  );
  await emptyPage.clock.fastForward(Date.parse("2026-09-21T05:01:00Z") - now);
  await expect(emptyPage.locator(".chart-surface")).toHaveAttribute(
    "data-domain-start",
    String(Date.parse("2026-09-21T05:00:00Z")),
  );
  await expect(emptyPage.locator(".chart-now-marker")).toHaveAttribute(
    "data-time",
    String(Date.parse("2026-09-21T05:01:00Z")),
  );
  await emptyPage.close();
});

test("Week periods apply every day and survive reloads, edits, and deselection", async ({page}, testInfo) => {
  await page.goto("/?tab=Week");
  await page.getByText("Times of interest", {exact:true}).click();
  const editor = page.locator('.week-periods');
  const cards = page.locator('.week-card');
  const count = await cards.count();
  await expect(editor.getByRole('checkbox', {name:'Early morning',exact:true})).toBeChecked();
  await editor.getByRole('button',{name:'Add period',exact:true}).click();
  await editor.getByLabel('Period name').fill('Mid morning');
  await editor.getByLabel('Start time').fill('09:15');
  await editor.getByLabel('End time').fill('08:00');
  await editor.getByRole('button',{name:'Save period',exact:true}).click();
  await expect(editor.getByRole('alert')).toContainText('End time must be after');
  await editor.getByLabel('End time').fill('11:00');
  await editor.getByRole('button',{name:'Save period',exact:true}).click();
  await expect(cards.locator('.practice-window')).toHaveCount(count * 3);
  for (const card of await cards.all()) await expect(card).toContainText('Mid morning 9:15 AM – 11:00 AM');
  await page.reload();
  await expect(cards.first()).toContainText('Mid morning');
  await page.getByText("Times of interest", {exact:true}).click();
  await editor.getByRole('button',{name:'Edit Mid morning',exact:true}).click();
  await editor.getByLabel('Period name').fill('Late morning');
  await editor.getByLabel('Start time').fill('10:00');
  await editor.getByRole('button',{name:'Save period',exact:true}).click();
  await expect(cards.first()).toContainText('Late morning 10:00 AM – 11:00 AM');
  await editor.getByRole('checkbox',{name:'Early morning',exact:true}).uncheck();
  await expect(cards.locator('.practice-window')).toHaveCount(count * 2);
  await page.setViewportSize({width:390,height:844});
  await editor.screenshot({path:`/tmp/week-periods-${testInfo.project.name}.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await editor.getByRole('button',{name:'Remove Late morning',exact:true}).click();
  await editor.getByRole('checkbox',{name:'Evening',exact:true}).uncheck();
  await expect(cards.locator('.practice-window')).toHaveCount(0);
  await page.reload();
  await expect(cards.locator('.practice-window')).toHaveCount(0);
  await cards.nth(1).click();
  await expect(cards.nth(1)).toHaveAttribute('aria-pressed','true');
});

test("weekday controls filter each local day, preserve legacy periods, and keep empty days selectable", async ({page}, testInfo) => {
  const now=Date.parse('2026-09-21T14:00:00Z');
  await page.clock.install({time:new Date(now)});
  await page.addInitScript(()=>localStorage.setItem('mendocean-week-periods-v1',JSON.stringify([
    {id:'morning',label:'Early morning',start:'05:30',end:'07:00',enabled:true},
    {id:'evening',label:'Evening',start:'18:00',end:'19:30',enabled:true}
  ])));
  await page.route('**/api/weather',route=>route.fulfill({json:{fetched_at:new Date(now).toISOString(),provider:'Test fixture',source_kind:'fixture',model_version:'hannah-1.0.0',current:null,hours:Array.from({length:192},(_,i)=>({time:new Date(now+i*3600000).toISOString(),wind:7,direction:180,gust:10,temperature:65,precipitation:0,probability:0,visibility:16000,code:0}))}}));
  await page.goto('/?tab=Week');
  await page.getByText('Times of interest',{exact:true}).click();
  const editor=page.locator('.week-periods');
  const cards=page.locator('.week-card');
  await expect(cards.first()).toContainText('Mon, Sep 21');
  await editor.getByRole('button',{name:'Edit Early morning',exact:true}).click();
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  for(const name of days) await expect(editor.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');
  await editor.getByRole('button',{name:'Weekdays',exact:true}).click();
  await expect(editor.getByRole('button',{name:'Saturday',exact:true})).toHaveAttribute('aria-pressed','false');
  await editor.getByRole('button',{name:'Tuesday',exact:true}).click();
  await editor.getByRole('button',{name:'Thursday',exact:true}).click();
  await editor.getByRole('button',{name:'Save period',exact:true}).click();
  for(let i=0;i<7;i++) {
    if([0,2,4].includes(i)) await expect(cards.nth(i)).toContainText('Early morning');
    else await expect(cards.nth(i)).not.toContainText('Early morning');
  }
  await expect(editor).toContainText('Mon, Wed, Fri');
  await editor.getByRole('checkbox',{name:'Evening',exact:true}).uncheck();
  await expect(cards.nth(1).locator('.practice-window')).toHaveCount(0);
  await cards.nth(1).click();
  await expect(cards.nth(1)).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.weather-chart')).toBeVisible();
  await page.reload();
  await expect(cards.first()).toContainText('Early morning');
  await expect(cards.nth(1)).not.toContainText('Early morning');
  await page.getByText('Times of interest',{exact:true}).click();
  await editor.getByRole('button',{name:'Edit Early morning',exact:true}).click();
  for(const name of ['Monday','Wednesday','Friday']) await editor.getByRole('button',{name,exact:true}).click();
  await editor.getByRole('button',{name:'Save period',exact:true}).click();
  await expect(editor.getByRole('alert')).toHaveText('Choose at least one day.');
  await editor.getByRole('button',{name:'Weekends',exact:true}).click();
  await editor.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(editor).toContainText('Mon, Wed, Fri');
  await editor.getByRole('button',{name:'Edit Early morning',exact:true}).click();
  await page.setViewportSize({width:320,height:844});
  await editor.screenshot({path:`/tmp/weekdays-editor-${testInfo.project.name}.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await editor.getByRole('button',{name:'Every day',exact:true}).click();
  await editor.getByRole('button',{name:'Save period',exact:true}).click();
  await expect(cards.locator('.practice-window')).toHaveCount(7);
});
