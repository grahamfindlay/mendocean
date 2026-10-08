import { test, expect } from "@playwright/test";
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
