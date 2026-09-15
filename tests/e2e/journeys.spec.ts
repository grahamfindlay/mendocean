import { test, expect, chromium, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  user,
  api,
  db,
  sql,
  cleanupUsers,
  ensureWeather,
  fixtures,
  tick,
  practice,
  syntheticToken,
  localURL,
  type Actor,
} from "../support/stack";
import { report } from "../fixtures";
let actor: Actor;
test.beforeAll(async () => {
  await ensureWeather();
});
test.beforeEach(async () => {
  actor = await user();
});
test.afterEach(async () => {
  await cleanupUsers([actor]);
});
test.afterAll(async () => {
  await sql.end();
});
async function session(page: Page, a = actor) {
  const { data } = await a.client.auth.getSession();
  const key =
    "sb-" +
    new URL(localURL("TEST_SUPABASE_URL")).hostname.split(".")[0] +
    "-auth-token";
  await page.addInitScript(
    ({ key, session }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(session));
    },
    { key, session: data.session },
  );
}
async function loggedIn(page: Page) {
  await session(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Account", exact: true }),
  ).toBeVisible();
}
async function startLog(page: Page) {
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "How was the water?" }),
  ).toBeVisible();
}
async function chooseRow(page: Page) {
  await page.getByRole("button", { name: "2 Good", exact: true }).click();
  await page.getByRole("button", { name: "East", exact: true }).click();
}
async function records(a = actor) {
  return (await api(a, "account")).data.outings.flatMap((o: any) => o.reports);
}
async function waitForWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
}
test("production bundle cannot enable development preview", async ({
  page,
}) => {
  await page.goto("/?preview=1");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Account", exact: true }),
  ).toHaveCount(0);
});
test("real invited email OTP succeeds and an invalid code is rejected", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(actor.email);
  await page.getByRole("button", { name: "Send a code", exact: true }).click();
  await page.getByLabel("Sign-in code", { exact: true }).fill("00000000");
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  let code = "";
  await expect
    .poll(
      async () => {
        const list = await (
          await fetch(localURL("TEST_MAIL_URL") + "/api/v1/messages")
        ).json();
        const m = list.messages?.find((m: any) =>
          m.To?.some((t: any) => t.Address === actor.email),
        );
        if (!m) return false;
        const msg = await (
          await fetch(localURL("TEST_MAIL_URL") + "/api/v1/message/" + m.ID)
        ).json();
        code = (msg.Text || msg.HTML || "").match(/\b\d{6,8}\b/)?.[0] || "";
        return !!code;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await page.getByLabel("Sign-in code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: "Account", exact: true }),
  ).toBeVisible();
});
test("independent row persists, reloads, edits; unwanted scope field absent", async ({
  page,
}) => {
  await loggedIn(page);
  await startLog(page);
  await chooseRow(page);
  await expect(page.getByText("This report describes")).toHaveCount(0);
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(page.getByText("2 · Good · east")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "My outings", exact: true }).click();
  await expect(page.getByText("2 · Good · east")).toBeVisible();
  await page.getByRole("button", { name: "Edit report", exact: true }).click();
  await page.getByRole("button", { name: "3 Fine", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(async () => (await records())[0]?.rating).toBe(3);
  expect((await records())[0].coach_state).toBe("uncoached");
});
test("imported practice prefills boat and survives report submission", async ({
  page,
}) => {
  const id = 300000 + Math.floor(Math.random() * 100000);
  await fixtures({ bhc: [practice(id)], lineup: true });
  await api(actor, "bhc/connect", { token: syntheticToken });
  await tick();
  const o = (await api(actor, "account")).data.outings.find(
    (o: any) => o.bhc_practice_id === id,
  );
  await loggedIn(page);
  await startLog(page);
  await page
    .getByRole("combobox", { name: "Which outing?", exact: true })
    .selectOption(o.id);
  await chooseRow(page);
  await page.locator("details.form-card > summary").click();
  await expect(
    page.getByRole("combobox", { name: "Your boat", exact: true }),
  ).toHaveValue("2x");
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect.poll(async () => (await records())[0]?.boat_class).toBe("2x");
  await api(actor, "bhc/disconnect", {});
});
test("offline submission reconnects once; preferences persist", async ({
  page,
  context,
}) => {
  await loggedIn(page);
  await waitForWorker(page);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Reminders", exact: true })
    .selectOption("push");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page.getByText("Preferences saved.")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await startLog(page);
  await page
    .getByRole("button", { name: "Stayed ashore", exact: true })
    .click();
  await page.getByLabel("What kept you ashore?").selectOption("wind_waves");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(page.getByText("On this device · 1 pending")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("On this device · 1 pending")).toHaveCount(0);
  await expect.poll(async () => (await records()).length).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Reminders", exact: true }),
  ).toHaveValue("push");
});
test("concurrent edit presents a recoverable conflict", async ({ page }) => {
  await loggedIn(page);
  await startLog(page);
  await chooseRow(page);
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit report", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit report", exact: true }).click();
  const o = (await api(actor, "account")).data.outings[0];
  await api(actor, "report", {
    outing: o,
    report: {
      ...o.reports[0],
      submission_id: crypto.randomUUID(),
      expected_version: 1,
      rating: 4,
    },
  });
  await page.getByRole("button", { name: "3 Fine", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText(/changed elsewhere/).first()).toBeVisible();
  expect((await records())[0].rating).toBe(4);
});
test("persistent browser profile reopens offline and uploads queued report", async ({}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Persistent profile scenario runs in Chromium",
  );
  const parent = process.env.TEST_PROFILE_ROOT!;
  await mkdir(parent, { recursive: true });
  const profile = await mkdtemp(join(parent, "browser-"));
  let ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    baseURL: process.env.TEST_APP_URL,
  });
  try {
    let page = ctx.pages()[0];
    await loggedIn(page);
    await waitForWorker(page);
    await startLog(page);
    await chooseRow(page);
    await ctx.setOffline(true);
    await page
      .getByRole("button", { name: "Save report", exact: true })
      .click();
    await expect(page.getByText("On this device · 1 pending")).toBeVisible();
    await ctx.close();
    ctx = await chromium.launchPersistentContext(profile, {
      headless: true,
      baseURL: process.env.TEST_APP_URL,
      offline: true,
    });
    page = ctx.pages()[0];
    await page.goto(process.env.TEST_APP_URL! + "/?log=1");
    await expect(
      page.getByRole("button", { name: "Account", exact: true }),
    ).toBeVisible();
    await ctx.setOffline(false);
    await expect.poll(async () => (await records()).length).toBe(1);
  } finally {
    await ctx.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("drafts stay separate across account switches", async ({ page }) => {
  const other = await user();
  try {
    await loggedIn(page);
    await startLog(page);
    await chooseRow(page);
    // Wait for the debounced draft to reach IndexedDB, not for an arbitrary delay.
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const request = indexedDB.open("mendocean-private");
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const r = db.transaction("drafts").objectStore("drafts").count();
            return await new Promise<number>(
              (resolve) => (r.onsuccess = () => resolve(r.result)),
            );
          } finally {
            db.close();
          }
        }),
      )
      .toBe(1);
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    // Reuse a legitimately authenticated test session; the OTP journey is tested separately.
    const { data } = await other.client.auth.getSession();
    const key =
      "sb-" +
      new URL(localURL("TEST_SUPABASE_URL")).hostname.split(".")[0] +
      "-auth-token";
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
      { key, value: data.session },
    );
    await page.reload();
    await startLog(page);
    await expect(
      page.getByRole("button", { name: "2 Good", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(await records(other)).toHaveLength(0);
    const original = await actor.client.auth.getSession();
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
      { key, value: original.data.session },
    );
    await page.reload();
    await startLog(page);
    await expect(
      page.getByText("Your unfinished draft was restored from this device."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "2 Good", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    await cleanupUsers([other]);
  }
});

test("push setup explains dismissed permission and tests only the saved device", async ({
  page,
}) => {
  const endpoint = "https://web.push.apple.com/" + crypto.randomUUID();
  await page.addInitScript((endpoint) => {
    let permissionRequests = 0;
    let subscription: any = null;
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: class {
        static async requestPermission() {
          return ++permissionRequests === 1 ? "default" : "granted";
        }
      },
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: class {},
    });
    Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {
      configurable: true,
      get: () => ({
        getSubscription: async () => subscription,
        subscribe: async () =>
          (subscription = {
            endpoint,
            toJSON: () => ({
              endpoint,
              keys: { auth: "synthetic", p256dh: "synthetic" },
            }),
          }),
      }),
    });
  }, endpoint);
  await loggedIn(page);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable push on this device", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Permission was not granted",
  );
  await page
    .getByRole("button", { name: "Enable push on this device", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "This device is registered",
  );
  await page
    .getByRole("button", {
      name: "Send test notification to this device",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText("Test accepted");
  const state = await fixtures();
  expect(state.deliveries.some((d: any) => d.target === endpoint)).toBe(true);
});
