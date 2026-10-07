import { test, expect, type Page } from "@playwright/test";
const OWNER = "10000000-0000-4000-8000-000000000001";
const MEMBER = "10000000-0000-4000-8000-000000000002";
const SOURCE = "20000000-0000-4000-8000-000000000001";
const TARGET = "20000000-0000-4000-8000-000000000002";
async function fixture(
  page: Page,
  role: "admin" | "member" | "anonymous" = "admin",
) {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
  if (role !== "anonymous")
    await page.addInitScript(
      ({ OWNER }) => {
        localStorage.setItem(
          "sb-127-auth-token",
          JSON.stringify({
            access_token: "fixture-access-token",
            refresh_token: "fixture-refresh-token",
            token_type: "bearer",
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: {
              id: OWNER,
              aud: "authenticated",
              role: "authenticated",
              email: "owner@example.test",
              created_at: "2026-10-01T12:00:00Z",
            },
          }),
        );
      },
      { OWNER },
    );
  let rows = [
    {
      id: SOURCE,
      title: "Duplicate morning row",
      kind: "independent",
      starts_at: "2026-10-06T11:00:00Z",
      ends_at: "2026-10-06T12:30:00Z",
      actual_starts_at: null,
      actual_ends_at: null,
    },
    {
      id: TARGET,
      title: "Official morning practice",
      kind: "official",
      starts_at: "2026-10-06T11:00:00Z",
      ends_at: "2026-10-06T12:30:00Z",
      actual_starts_at: "2026-10-06T11:05:00Z",
      actual_ends_at: "2026-10-06T12:20:00Z",
    },
  ];
  const calls: { path: string; body: any }[] = [];
  const monitoringUser = (id: string, name: string, role: string) => ({
    id,
    display_name: name,
    role,
    approved: true,
    invited_at: "2026-10-01T12:00:00Z",
    first_observed_at: null,
    last_observed_at: "2026-10-06T14:55:00Z",
    report_count: 4,
    reports_created: 2,
    last_report_at: "2026-10-05T14:00:00Z",
    bhc_connected: true,
    last_sync: "2026-10-06T14:00:00Z",
    bhc_problem: false,
    reminder_channels: ["email", "push"],
    reminders_paused: false,
    reminder_problem: false,
  });
  let invited = false;
  let modelPublished = false;
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/functions/v1/api/", "");
    const body = route.request().postDataJSON();
    calls.push({ path: path + url.search, body });
    if (url.pathname === "/auth/v1/logout")
      return route.fulfill({ status: 204 });
    if (path === "account")
      return route.fulfill({
        json: {
          outings: [],
          coaches: [],
          push_devices: 0,
          profile: {
            id: OWNER,
            display_name: "Owner",
            role,
            reminder_channels: [],
            reminders_paused: false,
          },
          bhc: { connected: false, last_sync: null, last_error: null },
        },
      });
    if (path === "weather")
      return route.fulfill({
        json: {
          fetched_at: new Date().toISOString(),
          provider: "Fixture",
          source_kind: "fixture",
          model_version: "hannah-1.0.0",
          current: null,
          hours: [],
        },
      });
    if (path === "activity/observe")
      return route.fulfill({ json: { observed: true } });
    if (role !== "admin")
      return route.fulfill({
        status: 403,
        json: { error: "Administrator access required." },
      });
    if (path === "admin/activity")
      return route.fulfill({
        json: {
          started_at: "2026-10-01T12:00:00Z",
          days: Number(url.searchParams.get("days")),
          summary: { active_users: 1, contributors: 1, reports_created: 2 },
          users: [
            monitoringUser(OWNER, "Graham Findlay", "admin"),
            monitoringUser(MEMBER, "Pilot Rower", "member"),
            ...(invited
              ? [
                  monitoringUser(
                    "10000000-0000-4000-8000-000000000003",
                    "New pilot user",
                    "member",
                  ),
                ]
              : []),
          ],
        },
      });
    if (path === "admin/operations")
      return route.fulfill({
        json: {
          started_at: "2026-10-01T12:00:00Z",
          last_weather: new Date().toISOString(),
          last_tick_completed_at: new Date().toISOString(),
          overdue_jobs: 0,
          retries_24h: 1,
          failed_jobs_24h: 0,
          api_failures_15m: 0,
          api_affected_users_15m: 0,
          bhc_problems: 0,
          reminder_problems: 0,
          recent_events: [],
        },
      });
    if (path === "health")
      return route.fulfill({
        json: {
          database_bytes: 12300000,
          weather_storage_bytes: 5600000,
          failed_jobs: 0,
          last_weather: new Date().toISOString(),
          models: [
            {
              id: "model-fixture",
              created_at: "2026-10-05T12:00:00Z",
              status: modelPublished ? "active" : "shadow",
              eligible: true,
              current_revision: true,
              metrics: { held_out_accuracy: 0.8 },
            },
          ],
        },
      });
    if (path === "admin/outings") return route.fulfill({ json: rows });
    if (path === "admin/timeline")
      return route.fulfill({
        json: {
          events: [
            {
              id: 1,
              at: "2026-10-06T14:55:00Z",
              event: "report_created",
              details: {},
            },
          ],
        },
      });
    if (path === "invite") invited = true;
    if (path === "models/publish") modelPublished = true;
    if (path === "models/rollback") modelPublished = false;
    if (path === "outings/reconcile")
      rows = rows.filter((o) => o.id !== body.source);
    if (path === "outings/interval")
      rows = rows.map((o) =>
        o.id === body.id
          ? { ...o, actual_starts_at: body.start, actual_ends_at: body.end }
          : o,
      );
    return route.fulfill({ json: { saved: true } });
  });
  return calls;
}
async function menu(page: Page, label: string) {
  const toggle = page.getByRole("button", { name: /^Menu ·/ });
  if (await toggle.isVisible()) await toggle.click();
  await page
    .getByRole("navigation", { name: "Administration", exact: true })
    .getByRole("link", { name: label, exact: true })
    .click();
}
async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("admin area offers deep links, back/forward, and responsive account activity", async ({
  page,
}, info) => {
  await fixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Invite a pilot user" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Open administration" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Service ready", { exact: true })).toBeVisible();
  await menu(page, "Accounts & activity");
  await expect(page).toHaveURL(/\/admin\/accounts$/);
  await page
    .getByRole("combobox", { name: "Period", exact: true })
    .selectOption("30");
  await expect(page.getByText(/2 new reports in 30 days/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pilot Rower", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/admin/accounts-${info.project.name}.png`,
    fullPage: true,
  });
  await fits(page);
  await page.getByRole("button", { name: "Pilot Rower", exact: true }).click();
  await expect(page.getByLabel("Account ID for PostHog search")).toHaveValue(
    MEMBER,
  );
  await expect(page.getByText(/report created/)).toBeVisible();
  await page.getByRole("button", { name: "Close history" }).click();
  await expect(page.getByLabel("Account ID for PostHog search")).toHaveCount(0);
  await menu(page, "Operations");
  await expect(
    page.getByText("Last completed dispatch", { exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Accounts & activity", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Operations", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Last completed dispatch", { exact: true }),
  ).toBeVisible();
  await fits(page);
  await page.getByRole("link", { name: "Back to Mendocean" }).click();
  await expect(
    page.getByRole("link", { name: "Administration", exact: true }),
  ).toBeVisible();
});

test("duplicate merge needs review and confirmation and keeps API conflicts visible", async ({
  page,
}, info) => {
  const calls = await fixture(page);
  await page.goto("/admin/reconcile");
  await page
    .getByRole("combobox", { name: "Duplicate to merge", exact: true })
    .selectOption(SOURCE);
  const target = page.getByRole("combobox", {
    name: "Keep this row",
    exact: true,
  });
  await expect(target.locator(`option[value="${SOURCE}"]`)).toHaveCount(0);
  await target.selectOption(TARGET);
  await expect(
    page.getByText("Official practice", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/admin/reconcile-${info.project.name}.png`,
    fullPage: true,
  });
  await fits(page);
  await page.getByRole("button", { name: "Review merge" }).click();
  expect(calls.filter((c) => c.path === "outings/reconcile")).toHaveLength(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm merge" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Review merge" }).click();
  await page.route("**/functions/v1/api/outings/reconcile", (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: "Conflicting reports by the same person block the merge.",
      },
    }),
  );
  await page.getByRole("button", { name: "Confirm merge" }).click();
  await expect(page.getByRole("alert")).toContainText("Conflicting reports");
  await page.unroute("**/functions/v1/api/outings/reconcile");
  await page.getByRole("button", { name: "Confirm merge" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Rows reconciled." }),
  ).toHaveText("Rows reconciled.");
  expect(calls.find((c) => c.path === "outings/reconcile")?.body).toEqual({
    source: SOURCE,
    target: TARGET,
  });
  await expect(
    page
      .getByRole("combobox", { name: "Duplicate to merge", exact: true })
      .locator(`option[value="${SOURCE}"]`),
  ).toHaveCount(0);
});

test("actual time correction prefills saved times, validates ordering, and saves Madison time", async ({
  page,
}, info) => {
  const calls = await fixture(page);
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/admin/intervals");
  await page
    .getByRole("combobox", { name: "Row", exact: true })
    .selectOption(TARGET);
  await expect(
    page.getByLabel("Actual start · Madison", { exact: true }),
  ).toHaveValue("2026-10-06T06:05");
  await expect(
    page.getByLabel("Actual end · Madison", { exact: true }),
  ).toHaveValue("2026-10-06T07:20");
  await page.screenshot({
    path: `test-results/admin/intervals-${info.project.name}.png`,
    fullPage: true,
  });
  await fits(page);
  await page
    .getByLabel("Actual end · Madison", { exact: true })
    .fill("2026-10-06T05:00");
  await page.getByRole("button", { name: "Save interval" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Actual end must be after actual start.",
  );
  expect(calls.filter((c) => c.path === "outings/interval")).toHaveLength(0);
  await page
    .getByLabel("Actual end · Madison", { exact: true })
    .fill("2026-10-06T07:30");
  await page.getByRole("button", { name: "Save interval" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Actual interval saved." }),
  ).toHaveText(
    "Actual interval saved. Weather enrichment is queued. Forecasts now use Hannah’s rule.",
  );
  expect(calls.find((c) => c.path === "outings/interval")?.body).toEqual({
    id: TARGET,
    start: "2026-10-06T11:05:00.000Z",
    end: "2026-10-06T12:30:00.000Z",
  });
  await page.reload();
  await page
    .getByRole("combobox", { name: "Row", exact: true })
    .selectOption(TARGET);
  await expect(
    page.getByLabel("Actual end · Madison", { exact: true }),
  ).toHaveValue("2026-10-06T07:30");
});

test("invitations refresh accounts and model publication and rollback remain available", async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.goto("/admin/accounts");
  await page.getByLabel("Email", { exact: true }).fill("new@example.test");
  await page.getByRole("button", { name: "Create invited account" }).click();
  await expect(page.getByRole("status")).toContainText("Account created.");
  await expect(
    page.getByRole("button", { name: "New pilot user", exact: true }),
  ).toBeVisible();
  expect(calls.find((c) => c.path === "invite")?.body).toEqual({
    email: "new@example.test",
  });
  await menu(page, "Models");
  await page.getByText("Performance metrics", { exact: true }).click();
  await expect(page.locator(".metrics")).toContainText("held_out_accuracy");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Approve model" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Model published." }),
  ).toHaveText("Model published.");
  expect(calls.find((c) => c.path === "models/publish")?.body).toEqual({
    id: "model-fixture",
  });
  await page.getByRole("button", { name: "Return to Hannah’s rule" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Forecasts now use Hannah’s rule." }),
  ).toHaveText("Forecasts now use Hannah’s rule.");
  expect(calls.find((c) => c.path === "models/rollback")?.body).toEqual({});
});

for (const role of ["member", "anonymous"] as const)
  test(`${role} cannot open an admin deep link or fetch admin data`, async ({
    page,
  }) => {
    const calls = await fixture(page, role);
    await page.goto("/admin/intervals");
    await expect(
      page.getByText(
        role === "member"
          ? "This account does not have access to pilot administration."
          : "Sign in with your administrator account to continue.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Administration", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save interval" }),
    ).toHaveCount(0);
    expect(
      calls.some((c) => c.path.startsWith("admin/") || c.path === "health"),
    ).toBe(false);
  });

test("account loading failures are retryable and signing out clears admin content", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/functions/v1/api/account", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Account temporarily unavailable." },
    }),
  );
  await page.goto("/admin/models");
  await expect(page.getByRole("alert")).toHaveText(
    "Account temporarily unavailable.",
  );
  await page.unroute("**/functions/v1/api/account");
  await page.getByRole("button", { name: "Retry account loading" }).click();
  await expect(
    page.getByRole("button", { name: "Approve model" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve model" })).toHaveCount(
    0,
  );
});
