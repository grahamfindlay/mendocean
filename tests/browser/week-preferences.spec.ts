import { test, expect, type Page } from "@playwright/test";
import {
  DEFAULT_WEEK_PERIODS,
  type WeekPeriod,
} from "../../shared/weekPeriods";

const now = Date.parse("2026-09-20T12:00:00Z");
const personalized: WeekPeriod[] = [
  {
    id: "personal",
    label: "Personalized row",
    start: "09:00",
    end: "10:30",
    enabled: true,
    days: [0, 2, 5],
  },
];
const user = (id: string) => ({ id, email: `${id}@example.test` });
function gate() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => (release = resolve));
  return { wait, release };
}

// Exercise the real App, including auth restoration and navigation, with only
// the client boundary replaced. Requests are explicitly released by each test.
async function mount(
  page: Page,
  reply: (
    userId: string,
    body: { periods: WeekPeriod[] } | null,
  ) => unknown | Promise<unknown>,
  options: { session?: Promise<void>; signedIn?: boolean } = {},
) {
  await page.clock.install({ time: now });
  await page.route("**/src/client.ts", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
        export class ApiError extends Error {}
        export const previewMode = false;
        let currentUser = null;
        let sessionRequest;
        const listeners = new Set();
        window.__weekSetUser = (user) => {
          currentUser = user;
          for (const listener of listeners) listener('SIGNED_IN', user ? { user } : null);
        };
        export const supabase = { auth: {
          getSession: () => sessionRequest ||= fetch('/__week/session').then(r => r.json()).then(user => {
            currentUser = user;
            return { data: { session: user ? { user } : null } };
          }),
          onAuthStateChange: (listener) => {
            listeners.add(listener);
            return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
          }
        } };
        export async function api(path, body, expectedUser) {
          const response = await fetch('/__week/' + path + '?user=' + encodeURIComponent(expectedUser || currentUser?.id || ''), {
            method: body === undefined ? 'GET' : 'POST', body: JSON.stringify(body)
          });
          const data = await response.json();
          if (data.error) throw new Error(data.error);
          return data;
        }
        export const getWeather = () => api('weather');
      `,
    }),
  );
  await page.route("**/__week/**", async (route) => {
    const url = new URL(route.request().url());
    const id = url.searchParams.get("user") || "";
    if (url.pathname === "/__week/session") {
      await options.session;
      await route.fulfill({
        json: options.signedIn === false ? null : user("account-a"),
      });
    } else if (url.pathname === "/__week/weather") {
      await route.fulfill({
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
      });
    } else if (url.pathname === "/__week/week-periods/v2") {
      await route.fulfill({
        json: await reply(id, route.request().postDataJSON()),
      });
    } else if (url.pathname === "/__week/account") {
      await route.fulfill({
        json: {
          outings: [],
          coaches: [],
          profile: {
            id,
            display_name: id,
            role: "member",
            reminder_channel: "none",
            reminders_paused: false,
          },
          bhc: { connected: false, last_sync: null, last_error: null },
        },
      });
    } else await route.fulfill({ json: {} });
  });
  await page.goto("/?tab=Week");
}

async function setUser(page: Page, id: string | null) {
  await page.evaluate(
    (next) => {
      (window as any).__weekSetUser(next);
    },
    id ? user(id) : null,
  );
}

test("auth and preference loading never show default cards; navigation retains saved periods", async ({
  page,
}) => {
  const auth = gate();
  const load = gate();
  let requests = 0;
  await mount(
    page,
    async () => {
      requests++;
      await load.wait;
      return { periods: personalized };
    },
    { session: auth.wait },
  );
  const loading = page
    .getByRole("status")
    .filter({ hasText: "Loading your forecast periods" });
  await expect(loading).toBeVisible();
  await expect(page.locator(".week-card, .week-periods")).toHaveCount(0);
  expect(requests).toBe(0);
  auth.release();
  await expect.poll(() => requests).toBe(1);
  await expect(loading).toBeVisible();
  await expect(page.locator(".week-card")).toHaveCount(0);
  load.release();
  await expect(page.locator(".week-card")).toHaveCount(7);
  await expect(page.locator(".week-card").first()).toContainText(
    "No periods selected",
  );
  await expect(page.locator(".week-card").nth(1)).toContainText(
    "Personalized row",
  );
  await expect(page.locator(".week-grid")).not.toContainText("Early morning");
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.locator(".week-card").nth(1)).toContainText(
    "Personalized row",
  );
  await page.getByRole("button", { name: /History/, exact: true }).click();
  await page.getByRole("button", { name: "Forecasts", exact: true }).click();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.locator(".week-card").nth(1)).toContainText(
    "Personalized row",
  );
  expect(requests).toBe(1);
});

test("load failures show Retry outside the editor and accept empty saved periods", async ({
  page,
}) => {
  const retry = gate();
  let requests = 0;
  await mount(page, async () => {
    if (++requests === 1) return { error: "Unavailable" };
    await retry.wait;
    return { periods: [] };
  });
  await expect(page.getByRole("alert")).toContainText(
    "Could not load your saved forecast periods",
  );
  await expect(page.locator(".week-card, .week-periods")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Loading your forecast periods" }),
  ).toBeVisible();
  await expect(page.locator(".week-card")).toHaveCount(0);
  retry.release();
  await expect(page.locator(".week-no-periods")).toHaveCount(7);
  await expect(page.locator(".practice-window")).toHaveCount(0);
});

test("account changes discard old cards and ignore late loads", async ({
  page,
}) => {
  const first = gate();
  const second = gate();
  let startedA = false;
  let completedA = false;
  await mount(page, async (id) => {
    if (id === "account-a") {
      startedA = true;
      await first.wait;
      completedA = true;
      return { periods: personalized };
    }
    await second.wait;
    return { periods: DEFAULT_WEEK_PERIODS };
  });
  await expect.poll(() => startedA).toBe(true);
  await setUser(page, "account-b");
  first.release();
  await expect.poll(() => completedA).toBe(true);
  await expect(page.locator(".week-card")).toHaveCount(0);
  second.release();
  await expect(page.locator(".week-card").first()).toContainText(
    "Early morning",
  );
  await expect(page.locator(".week-grid")).not.toContainText(
    "Personalized row",
  );
  await setUser(page, null);
  await expect(page.locator(".week-card").first()).toContainText(
    "Early morning",
  );
  await expect(page.locator(".week-periods input").first()).toBeEnabled();
});

test("saved edits survive navigation and failed saves keep the previous periods", async ({
  page,
}) => {
  let periods = personalized;
  let fail = false;
  let loads = 0;
  await mount(page, (_id, body) => {
    if (!body) loads++;
    else if (fail) return { error: "Unavailable" };
    else periods = body.periods;
    return { periods };
  });
  await expect(page.locator(".week-card")).toHaveCount(7);
  await page.getByText("Times of interest", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Personalized row" }).click();
  await expect(page.locator(".week-no-periods")).toHaveCount(7);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.locator(".week-no-periods")).toHaveCount(7);
  expect(loads).toBe(1);
  await page.getByText("Times of interest", { exact: true }).click();
  fail = true;
  await page.getByRole("checkbox", { name: "Personalized row" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Your previous choices are unchanged",
  );
  await expect(page.locator(".week-no-periods")).toHaveCount(7);
});

test("late saves cannot update another account or the next sign-in to the same account", async ({
  page,
}) => {
  const save = gate();
  const loadB = gate();
  let saving = false;
  let loads = 0;
  await mount(page, async (id, body) => {
    if (!body) {
      loads++;
      if (id === "account-b") {
        await loadB.wait;
        return {
          periods: [{ ...personalized[0], label: "Other account row" }],
        };
      }
      return { periods: personalized };
    }
    saving = true;
    await save.wait;
    return { periods: body.periods };
  });
  await expect(page.locator(".week-card")).toHaveCount(7);
  await page.getByText("Times of interest", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Personalized row" }).click();
  await expect.poll(() => saving).toBe(true);
  await setUser(page, "account-b");
  await expect.poll(() => loads).toBe(2);
  await expect(page.locator(".week-card, .week-periods")).toHaveCount(0);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Loading your forecast periods" }),
  ).toBeVisible();
  loadB.release();
  await expect(page.locator(".week-card").nth(1)).toContainText(
    "Other account row",
  );
  await setUser(page, "account-a");
  await expect.poll(() => loads).toBe(3);
  await expect(page.locator(".week-card").nth(1)).toContainText(
    "Personalized row",
  );
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("week-periods/v2") && r.request().method() === "POST",
  );
  save.release();
  await response;
  await expect(page.locator(".week-card").nth(1)).toContainText(
    "Personalized row",
  );
});
