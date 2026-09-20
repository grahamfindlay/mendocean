import { test, expect, type Page } from "@playwright/test";

const row = (id: string, title = id) => ({
  id,
  title,
  kind: "independent",
  starts_at: "2026-09-20T12:00:00Z",
  ends_at: "2026-09-20T13:00:00Z",
  actual_starts_at: null,
  actual_ends_at: null,
});
const model = (id: string, overrides = {}) => ({
  id,
  created_at: "2026-09-20T12:00:00Z",
  status: "shadow",
  metrics: {},
  eligible: true,
  current_revision: true,
  ...overrides,
});
const health = (models: ReturnType<typeof model>[] = []) => ({
  database_bytes: 100,
  weather_storage_bytes: 100,
  failed_jobs: 0,
  last_weather: null,
  models,
});

// Render the real administration component with a controlled API boundary.
async function mount(
  page: Page,
  reply: (path: string, body: any) => unknown | Promise<unknown>,
) {
  await page.route("**/src/main.tsx", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import Admin from '/src/Admin.tsx';
      import '/src/styles.css';
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Admin));`,
    }),
  );
  await page.route("**/src/client.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export async function api(path, body) {
      const response = await fetch('/__admin/' + path, { method: body === undefined ? 'GET' : 'POST', body: JSON.stringify(body) });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data;
    }`,
    }),
  );
  await page.route("**/__admin/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/__admin/", "") + url.search;
    await route.fulfill({
      json: await reply(path, route.request().postDataJSON()),
    });
  });
  await page.goto("/");
  await page.getByText("Pilot administration", { exact: true }).click();
}

test("loading and failed health never claim there are no models; retry recovers", async ({
  page,
}) => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failed = true;
  await mount(page, async (path) => {
    if (path === "health") {
      await wait;
      return failed ? { error: "Unavailable" } : health();
    }
    return [];
  });
  await expect(page.getByText("Loading administration…")).toBeVisible();
  await expect(page.getByText(/No trained models yet/)).toHaveCount(0);
  release();
  await expect(page.getByRole("alert")).toContainText("Unavailable");
  await expect(page.getByText(/No trained models yet/)).toHaveCount(0);
  failed = false;
  await page
    .getByRole("button", { name: "Retry loading administration" })
    .click();
  await expect(page.getByText(/No trained models yet/)).toBeVisible();
});

test("older rows can be corrected, existing times are prefilled, and changes require confirmation", async ({
  page,
}) => {
  const posts: any[] = [];
  await mount(page, (path, body) => {
    if (path === "health")
      return health([model("active", { status: "active" })]);
    if (path === "admin/outings")
      return Array.from({ length: 200 }, (_, i) => row(String(i)));
    if (path === "admin/outings?offset=200")
      return [
        {
          ...row("old", "Older practice"),
          actual_starts_at: "2026-09-20T12:15:00Z",
          actual_ends_at: "2026-09-20T13:15:00Z",
        },
      ];
    posts.push({ path, body });
    return {};
  });
  await page.getByRole("button", { name: "Load older rows" }).click();
  await page
    .getByRole("combobox", { name: "Row", exact: true })
    .selectOption("old");
  await expect(page.getByLabel("Actual start · Madison")).toHaveValue(
    "2026-09-20T07:15",
  );
  await expect(page.getByLabel("Actual end", { exact: true })).toHaveValue(
    "2026-09-20T08:15",
  );
  await expect(page.getByText(/Scheduled:/)).toContainText("Current actual:");
  await page.getByLabel("Actual end", { exact: true }).fill("2026-09-20T06:00");
  await page.getByRole("button", { name: "Save interval" }).click();
  await expect(page.getByRole("alert")).toHaveText("End must be after start.");
  await page.getByLabel("Actual end", { exact: true }).fill("2026-09-20T08:30");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Older practice");
    expect(dialog.message()).toContain("learned model will be retired");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Save interval" }).click();
  expect(posts).toEqual([]);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Save interval" }).click();
  await expect(page.getByText(/Actual interval saved/)).toBeVisible();
  expect(posts).toEqual([
    {
      path: "outings/interval",
      body: {
        id: "old",
        start: "2026-09-20T12:15:00.000Z",
        end: "2026-09-20T13:30:00.000Z",
      },
    },
  ]);
});

test("merge excludes the source and names both independent rows before submitting", async ({
  page,
}) => {
  const posts: any[] = [];
  await mount(page, (path, body) => {
    if (path === "health") return health();
    if (path === "admin/outings")
      return [row("a", "Duplicate row"), row("b", "Kept row")];
    posts.push({ path, body });
    return {};
  });
  await page
    .getByRole("combobox", { name: "Keep this row", exact: true })
    .selectOption("a");
  await page
    .getByRole("combobox", { name: "Duplicate to merge", exact: true })
    .selectOption("a");
  await expect(
    page.getByRole("combobox", { name: "Keep this row", exact: true }),
  ).toHaveValue("");
  await expect(
    page
      .getByRole("combobox", { name: "Keep this row", exact: true })
      .locator('option[value="a"]'),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Keep this row", exact: true })
    .selectOption("b");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Duplicate row");
    expect(dialog.message()).toContain("Kept row");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Merge duplicate" }).click();
  await expect(page.getByText("Rows reconciled.")).toBeVisible();
  expect(posts).toEqual([
    { path: "outings/reconcile", body: { source: "a", target: "b" } },
  ]);
});

test("only eligible current models can be approved and rollback requires confirmation", async ({
  page,
}) => {
  const posts: any[] = [];
  await mount(page, (path, body) => {
    if (path === "health")
      return health([
        model("active", { status: "active" }),
        model("stale", { current_revision: false }),
        model("ineligible", { eligible: false }),
        model("ready"),
      ]);
    if (path === "admin/outings") return [];
    posts.push({ path, body });
    return {};
  });
  await expect(page.getByText(/Current forecasting method:/)).toContainText(
    "Learned model",
  );
  const models = page.locator(".admin-tools > details");
  await expect(models).toHaveCount(4);
  for (let i = 0; i < 4; i++) await models.nth(i).locator("summary").click();
  const approve = page.getByRole("button", { name: "Approve model" });
  for (let i = 0; i < 3; i++) await expect(approve.nth(i)).toBeDisabled();
  await expect(approve.nth(3)).toBeEnabled();
  await expect(page.getByText(/Training data has changed/)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await approve.nth(3).click();
  await expect(page.getByText("Model published.")).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Return to Hannah’s rule" }).click();
  expect(posts).toEqual([{ path: "models/publish", body: { id: "ready" } }]);
});
