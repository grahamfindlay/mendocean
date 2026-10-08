import { test, expect } from "@playwright/test";
import { normalizeLineup, lineupEmail } from "../../shared/lineups";
import {
  scenarioAttendance,
  scenarioBoats,
  longRowerName,
} from "../../supabase/functions/staging-test/scenarios";
test("lineup links select the practice, prioritize own boat and highlight the seat on phones", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("mendocean-preview-bhc", "true");
    const now = Date.now();
    // A first notification may arrive during an automatic service-worker update.
    // Its explicit destination must override the old foreground position.
    sessionStorage.setItem(
      "mendocean-update-position",
      JSON.stringify({
        tab: "Today",
        selectedLineup: "first",
        userId: "10000000-0000-4000-8000-000000000001",
        at: now,
      }),
    );
    const make = (id: string, title: string) => ({
      outing_id: id,
      title,
      starts_at: new Date(now + 3600000).toISOString(),
      ends_at: new Date(now + 7200000).toISOString(),
      location: "MRC Boathouse",
      plan: "Steady rowing",
      published: true,
      athlete_id: 42,
      checked_at: new Date(now).toISOString(),
      boats: [
        {
          boat_id: 1,
          name: "Other double",
          boat_class: "2x",
          coaches: [],
          seats: [
            {
              athlete_id: 50,
              name: "Other rower",
              seat: "2",
              side: "sculling",
            },
          ],
        },
        {
          boat_id: 7,
          name: "Pratt",
          boat_class: "8+",
          coaches: [
            {
              athlete_id: 90,
              name: "Rose Sears",
              email: "rsears@mendotarowingclub.com",
            },
          ],
          seats: [
            { athlete_id: 10, name: "Peter", seat: "coxswain", side: null },
            { athlete_id: 11, name: "Cricket", seat: "8", side: "port" },
            {
              athlete_id: 42,
              name: "Sample rower",
              seat: "3",
              side: "starboard",
            },
          ],
        },
      ],
    });
    localStorage.setItem(
      "mendocean-preview-lineups",
      JSON.stringify([
        make("first", "Earlier practice"),
        make("target", "Selected practice"),
      ]),
    );
  });
  await page.goto("/?preview=1&tab=Lineups&lineup=target");
  await expect(
    page.getByRole("heading", { name: "Selected practice", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Practice", exact: true }),
  ).toHaveValue("target");
  await expect(page.locator(".lineup-boat").first()).toContainText("Pratt");
  await expect(page.locator(".lineup-you")).toContainText("3 seat");
  await expect(page.locator(".lineup-you")).toContainText("You");
  await expect(page.locator(".lineup-you .lineup-seat-label")).toHaveAttribute(
    "aria-label",
    "3 seat, starboard",
  );
  await expect(page.locator(".lineup-you .lineup-oar").first()).not.toHaveClass(
    /empty/,
  );
  const stroke = page
    .locator(".lineup-seats li")
    .filter({ hasText: "Cricket" });
  await expect(stroke.locator(".lineup-oar").first()).toHaveClass(/empty/);
  await expect(stroke.locator(".lineup-oar").last()).not.toHaveClass(/empty/);
  await expect(page.locator(".lineup-seats li").first()).toContainText("Cox");
  await expect(page.getByRole("link", { name: "Rose Sears" })).toHaveAttribute(
    "href",
    /^mailto:rsears%40mendotarowingclub\.com\?subject=Selected%20practice/,
  );
  await expect(page.locator(".lineups-view")).not.toContainText(
    "MRC Boathouse",
  );
  await page.getByRole("button", { name: "Forecasts", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Selected practice", exact: true }),
  ).toBeHidden();
  await page.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "NOTIFICATION_NAVIGATE",
          url: location.origin + "/?preview=1&tab=Lineups&lineup=target",
        },
      }),
    ),
  );
  await expect(
    page.getByRole("heading", { name: "Selected practice", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "NOTIFICATION_NAVIGATE",
          url: "https://other.test/?tab=Lineups&lineup=first",
        },
      }),
    ),
  );
  await expect(
    page.getByRole("heading", { name: "Selected practice", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Other rower", { exact: true })).toBeHidden();
  await page.getByText("Other boats (1)", { exact: true }).click();
  await expect(page.getByText("Other rower", { exact: true })).toBeVisible();
  await expect(page.locator(".lineups-view")).not.toContainText(
    /Avg Weight|Avg Age|Weight Rating/,
  );
  // An old logging destination must not override a newly selected lineup on reload.
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set("log", "previous-report");
    window.history.replaceState(null, "", url);
  });
  await page
    .getByRole("combobox", { name: "Practice", exact: true })
    .selectOption("first");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Earlier practice", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const seatBox = await page
    .locator(".lineup-you .lineup-seat-label")
    .boundingBox();
  const nameBox = await page
    .locator(".lineup-you .lineup-athlete")
    .boundingBox();
  expect(nameBox!.x - (seatBox!.x + seatBox!.width)).toBeGreaterThanOrEqual(16);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/lineup-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
test("Lineups navigation is hidden without a BHC integration", async ({
  page,
}) => {
  await page.goto("/?preview=1");
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Lineups", exact: true }),
  ).toHaveCount(0);
});

test("both crews and the longest MRC name fit one line at phone widths", async ({
  page,
}, testInfo) => {
  const starts = Math.floor(Date.now() / 1000) + 3600;
  const meta = {
    name: "Masters Recreational",
    start_time: starts,
    end_time: starts + 5400,
    lineups_set: "Yes",
  };
  const lineup = {
    ...normalizeLineup(
      meta,
      {
        lineups_set: "Yes",
        attendance: scenarioAttendance("publish", 900000002, null),
      },
      900000002,
      scenarioBoats,
    ),
    outing_id: "long-name",
    checked_at: new Date().toISOString(),
  };
  await page.addInitScript((lineup) => {
    localStorage.setItem("mendocean-preview-bhc", "true");
    localStorage.setItem("mendocean-preview-lineups", JSON.stringify([lineup]));
  }, lineup);
  await page.goto("/?preview=1&tab=Lineups&lineup=long-name");
  await expect(page.locator(".lineup-boat").first()).toContainText("River");
  await page.getByText("Other boats (1)", { exact: true }).click();
  await expect(page.locator(".lineup-boat").last()).toContainText("Cedar");
  await expect(page.getByText(longRowerName, { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const fits = () =>
    page
      .locator(".lineup-athlete, .lineup-seat-label > span")
      .evaluateAll((els) =>
        els.flatMap((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = [...range.getClientRects()];
          return rects.length === 1 &&
            rects[0].right <= el.getBoundingClientRect().right + 1
            ? []
            : [
                {
                  name: el.textContent,
                  lines: rects.length,
                  width: el.clientWidth,
                  font: getComputedStyle(el).font,
                },
              ];
        }),
      );
  for (const width of [320, 360, 375, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await fits(), `app rows fit at ${width}px`).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `test-results/lineup-two-boats-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const email = lineupEmail(
    lineup,
    "Lineup published",
    "https://mendocean-staging.pages.dev/?tab=Lineups",
    "https://mendocean-staging.pages.dev/?account=1",
    "published",
  );
  await page.setContent(email.html);
  for (const width of [320, 360, 375, 390, 430, 640]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.locator(".lineup-email-name").evaluateAll((els) =>
        els.flatMap((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = [...range.getClientRects()];
          return rects.length === 1 &&
            rects[0].right <= el.getBoundingClientRect().right + 1
            ? []
            : [
                {
                  name: el.textContent,
                  lines: rects.length,
                  width: el.clientWidth,
                  font: getComputedStyle(el).font,
                },
              ];
        }),
      ),
      `email names fit at ${width}px`,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
