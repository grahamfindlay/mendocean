import { test, expect, chromium, type Page } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  user,
  createOuting,
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
  const boat = page.getByRole("group", { name: "Select your boat class", exact: true });
  if (!(await boat.getByRole("button", { pressed: true }).count()))
    await boat.getByRole("button", { name: "1x", exact: true }).click();
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
  await page.getByRole("button", { name: "My rows", exact: true }).click();
  await page.getByRole("button", { name: "Past", exact: true }).click();
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
    .getByRole("combobox", { name: "Which row?", exact: true })
    .selectOption(o.id);
  await chooseRow(page);
  await expect(
    page.getByRole("group", { name: "Select your boat class", exact: true }).getByRole("button", { name: "2x", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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
    .getByRole("checkbox", { name: "Push notifications", exact: true })
    .check();
  await page.getByRole("checkbox", { name: "Email", exact: true }).check();
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
    page.getByRole("checkbox", { name: "Push notifications", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Email", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", { name: "Push notifications", exact: true })
    .uncheck();
  await page.getByRole("checkbox", { name: "Email", exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page.getByText("Preferences saved.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Push notifications", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Email", exact: true }),
  ).not.toBeChecked();
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
    const startupErrors: string[] = [];
    page.on("pageerror", (error) => startupErrors.push(error.message));
    await page.goto(process.env.TEST_APP_URL! + "/?log=1");
    try {
      await expect(
        page.getByRole("button", { name: "Account", exact: true }),
      ).toBeVisible();
    } catch (error) {
      console.log("Offline startup diagnostics", {
        errors: startupErrors,
        body: (await page.locator("body").innerText()).slice(0, 1200),
        state: await page.evaluate(async () => ({
          authStored: Object.keys(localStorage).some(
            (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
          ),
          controlled: !!navigator.serviceWorker.controller,
          cachedPaths: await Promise.all(
            (await caches.keys()).map(async (key) => ({
              key,
              paths: (await (await caches.open(key)).keys()).map(
                (r) => new URL(r.url).pathname,
              ),
            })),
          ),
        })),
      });
      throw error;
    }
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
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: class {
        static permission = "default";
        static async requestPermission() {
          this.permission = ++permissionRequests === 1 ? "default" : "granted";
          return this.permission;
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
  await expect(page.locator(".notice[role=status]")).toContainText(
    "Permission was not granted",
  );
  await page
    .getByRole("button", { name: "Enable push on this device", exact: true })
    .click();
  await expect(page.locator(".notice[role=status]")).toContainText(
    "This device is registered",
  );
  await page
    .getByRole("button", {
      name: "Send test notification to this device",
      exact: true,
    })
    .click();
  await expect(page.locator(".notice[role=status]")).toContainText(
    "Test accepted",
  );
  const state = await fixtures();
  expect(state.deliveries.some((d: any) => d.target === endpoint)).toBe(true);
});

test("upcoming, past and saved outing actions follow server reminder state", async ({
  page,
}) => {
  const future = await import("../support/stack").then((m) =>
    m.createOuting(actor, {
      title: "Tomorrow independent",
      starts_at: new Date(Date.now() + 86400000).toISOString(),
      ends_at: new Date(Date.now() + 91800000).toISOString(),
      reminder: true,
    }),
  );
  await api(actor, "settings", {
    display_name: "Synthetic",
    reminder_channel: "email",
    reminders_paused: false,
  });
  const past = await import("../support/stack").then((m) =>
    m.createOuting(actor, { title: "Finished independent", reminder: true }),
  );
  await loggedIn(page);
  await page.getByRole("button", { name: "My rows", exact: true }).click();
  await expect(page.getByRole("heading", { name: future.title })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log this row" })).toHaveCount(
    0,
  );
  await expect(page.getByText(/Logging reminder scheduled/)).toBeVisible();
  await page.getByRole("button", { name: "Past", exact: true }).click();
  await expect(page.getByRole("heading", { name: past.title })).toBeVisible();
  // Reminder controls live behind the card's More disclosure; its state stays
  // on the face of the card.
  const pastCard = page.locator(".outing-card").filter({ hasText: past.title });
  await pastCard.getByRole("button", { name: "More" }).click();
  await expect(pastCard.getByRole("button", { name: /Remind me/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Log this row" }).click();
  await chooseRow(page);
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(page.getByText("Report saved.", { exact: true })).toBeVisible();
  await expect(page.locator(".outing-reminder")).toHaveCount(0);
  await page.locator(".row-filters > summary").click();
  await page.selectOption('label:has-text("Reports") select', "Unlogged");
  await expect(page.getByRole("heading", { name: past.title })).toHaveCount(0);
  await page.selectOption('label:has-text("Reports") select', "Logged");
  await expect(page.getByRole("heading", { name: past.title })).toBeVisible();
});

test("Scheduled forecasts remain chart-only when model contexts are available", async ({
  page,
}) => {
  const id = crypto.randomUUID();
  const family = {
    launch: {
      eligible: true,
      outings: 120,
      coefficients: [Math.log(7 / 3), 0, 0, 0, 0, 0, 0, 0],
    },
    water: { eligible: false, outings: 0 },
  };
  const artifact = {
    version: "validated-test-model",
    eligible: true,
    context: "synthetic",
    pooled: { ...family, contextual: { "east|2x|Charlie": family } },
    personal: {},
  };
  await sql.query(
    "insert into private.model_runs(id,family,artifact,metrics,status) values($1,'synthetic',$2,'{}','active')",
    [id, artifact],
  );
  try {
    expect((await api(null, "assessment/capabilities")).data).toEqual({
      pooled: [
        { route: "either", boat: "any", coach: "none" },
        { route: "east", boat: "2x", coach: "Charlie" },
      ],
      mine: [],
    });
    // Model capabilities remain available to the API without adding assessment
    // controls or results to the scheduled forecast view.
    await import("../support/stack").then((m) =>
      m.createOuting(actor, {
        title: "Model context row",
        starts_at: new Date(Date.now() + 86400000).toISOString(),
        ends_at: new Date(Date.now() + 91800000).toISOString(),
      }),
    );
    await loggedIn(page);
    await page
      .getByRole("button", { name: "Scheduled rows", exact: true })
      .click();
    await expect(page.locator(".weather-chart")).toHaveCount(0);
    await page.locator(".row-card").filter({ hasText: "Model context row" }).click();
    await expect(page.locator('.row-card[aria-pressed="true"] h3')).toHaveText(
      "Model context row",
    );
    await expect(
      page.getByRole("combobox", { name: "Route", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "What logged rows suggest" }),
    ).toHaveCount(0);
    await expect(page.locator(".weather-chart")).toHaveCount(1);
    await expect(page.locator(".chart-highlight")).toHaveCount(1);
  } finally {
    await sql.query("delete from private.model_runs where id=$1", [id]);
  }
});

test("production timeline offers quarter-hour inspection and selectable daily forecasts", async ({
  page,
}) => {
  await page.goto("/?tab=Today");
  const chart = page.getByRole("region", {
    name: "All day",
    exact: true,
  });
  await expect(chart).toBeVisible();
  const initialIndex = Number(
    await chart.getByRole("slider").getAttribute("aria-valuenow"),
  );
  await chart.getByRole("slider").press("ArrowRight");
  await expect(chart.getByRole("slider")).toHaveAttribute(
    "aria-valuenow",
    String(initialIndex + 1),
  );
  await expect(chart.locator(".chart-now-marker")).toHaveCount(1);
  await expect(chart.locator(".chart-reading")).not.toContainText(
    "Precipitation",
  );
  await expect(
    page.getByRole("region", { name: "All day", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.locator(".week-card").nth(1).click();
  await expect(page.locator(".week-card").nth(1)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Detailed forecast for this day", { exact: true })).toHaveCount(0);
  await expect(page.locator(".chart-period-highlight")).toHaveCount(2);
});

test("partial reminder delivery is visible without implying device registration", async ({
  page,
}) => {
  await api(actor, "settings", {
    display_name: "Synthetic",
    reminder_channels: ["email", "push"],
    reminders_paused: false,
  });
  await createOuting(actor, { reminder: true });
  await fixtures({
    failure: null,
    failed_targets: [],
    deliveries: [],
    attempts: [],
  });
  await tick();
  await loggedIn(page);
  await page.getByRole("button", { name: "My rows", exact: true }).click();
  await page.getByRole("button", { name: "Past", exact: true }).click();
  await expect(
    page.getByText("Logging reminder partially sent", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "More" }).first().click();
  await expect(page.locator(".channel-status")).toContainText("Email: Sent");
  await expect(page.locator(".channel-status")).toContainText(
    "Push: No registered device",
  );
  await expect(
    page.getByRole("button", {
      name: "Remind me again in 1 hour",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Email", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Push notifications", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByText("Push is selected, but no device is registered.", {
      exact: false,
    }),
  ).toBeVisible();
});

test("attendance changes persist in BHC, closed windows and uncertain sends stay explicit", async ({
  page,
}) => {
  const id = 2000000 + Math.floor(Math.random() * 100000);
  const p = {
    ...practice(id, "unknown"),
    start_time: Math.floor(Date.now() / 1000) + 86400,
    end_time: Math.floor(Date.now() / 1000) + 90000,
    attendance_window_start: Math.floor(Date.now() / 1000) - 3600,
    attendance_window_end: Math.floor(Date.now() / 1000) + 3600,
    set_attendance_allowed: true,
  };
  await fixtures({ bhc: [p], failure: null, calls: [] });
  await api(actor, "bhc/connect", { token: syntheticToken });
  await tick();
  await loggedIn(page);
  await page.getByRole("button", { name: "My rows", exact: true }).click();
  const card = page.locator(".outing-card").filter({ hasText: p.name });
  await card.getByRole("button", { name: "More" }).click();
  await card
    .getByRole("button", { name: "Change attendance", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Status checked with BHC.")).toBeVisible();
  await dialog.getByLabel("Your attendance").selectOption("attending");
  await dialog.getByRole("button", { name: "Save attendance in BHC" }).click();
  await expect(dialog.getByText("Attendance updated in BHC.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(card.locator(".attendance-badge")).toHaveText("Attending");
  await page.reload();
  await page.getByRole("button", { name: "My rows", exact: true }).click();
  await expect(card.locator(".attendance-badge")).toHaveText("Attending");
  // A reload closes the disclosure again.
  await card.getByRole("button", { name: "More" }).click();
  await card
    .getByRole("button", { name: "Change attendance", exact: true })
    .click();
  await expect(dialog.getByText("Status checked with BHC.")).toBeVisible();
  await fixtures({ failure: "attendance_unreadable" });
  await dialog.getByLabel("Your attendance").selectOption("declined");
  await dialog.getByRole("button", { name: "Save attendance in BHC" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "could not be confirmed",
  );
  await expect(
    dialog.getByRole("button", { name: "Save attendance in BHC" }),
  ).toHaveCount(0);
  await fixtures({ failure: null });
  await dialog.getByRole("button", { name: "Check BHC status" }).click();
  await expect(dialog.getByText("In BHC: Not attending")).toBeVisible();
  const writes = (await fixtures()).calls.filter(
    (c: any) => c.path === "/practices/setAttendance",
  );
  expect(writes).toHaveLength(2);
  await fixtures({
    bhc: [
      {
        ...p,
        attendance_window_end: Math.floor(Date.now() / 1000) - 1,
        current_attendance_status: "Not Attending",
      },
    ],
  });
  await dialog.getByRole("button", { name: "Check BHC status" }).click();
  await expect(
    dialog.getByText(/The attendance deadline has passed/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Save attendance in BHC" }),
  ).toHaveCount(0);
  // R27. Both routes out of a change this screen cannot make, and a mailto
  // that drafts rather than sends.
  const coaches = dialog.getByRole("link", {
    name: "coaches@mendotarowingclub.com",
  });
  expect(await coaches.getAttribute("href")).toMatch(
    /^mailto:coaches@mendotarowingclub\.com\?subject=Attendance/,
  );
  await expect(
    dialog.getByRole("link", { name: "Open Boathouse Connect" }),
  ).toHaveAttribute("href", "https://app.boathouseconnect.com/home/login");
  await page.context().setOffline(true);
  await dialog.getByRole("button", { name: "Check BHC status" }).click();
  await expect(dialog.getByRole("alert")).toContainText("not saved offline");
  await page.context().setOffline(false);
  await api(actor, "bhc/disconnect", {});
});

// Request interception must not be bypassed by WebKit’s service worker.
test.describe("Week preference persistence", () => {
  test.use({serviceWorkers: "block"});
test("Week periods save to the account, survive a new device, and retain choices on failure", async ({page, browser}) => {
  await loggedIn(page);
  await page.route('**/api/week-periods/v2', route => route.fulfill({status:503,json:{error:'Unavailable'}}));
  await page.getByRole('button',{name:'Week',exact:true}).click();
  await page.getByText('Times of interest',{exact:true}).click();
  const editor = page.locator('.week-periods');
  await expect(editor.getByRole('alert')).toContainText('Could not load');
  await expect(editor.getByRole('button',{name:'Add period',exact:true})).toBeDisabled();
  await page.unroute('**/api/week-periods/v2');
  await editor.getByRole('button',{name:'Retry',exact:true}).click();
  await editor.getByRole('button',{name:'Add period',exact:true}).click();
  await editor.getByLabel('Period name').fill('Mid morning');
  await editor.getByLabel('Start time').fill('09:00');
  await editor.getByLabel('End time').fill('11:00');
  await page.route('**/api/week-periods/v2', route => route.fulfill({status:503,json:{error:'Unavailable'}}));
  await editor.getByRole('button',{name:'Save period',exact:true}).click();
  await expect(editor.getByRole('alert')).toContainText('Could not save');
  await expect(page.locator('.week-card').first()).not.toContainText('Mid morning');
  await page.unroute('**/api/week-periods/v2');
  await editor.getByRole('button',{name:'Save period',exact:true}).click();
  await expect(page.locator('.week-card').first()).toContainText('Mid morning');
  expect((await api(actor,'week-periods')).data.periods).toHaveLength(3);
  await editor.getByRole('button',{name:'Edit Mid morning',exact:true}).click();
  await editor.getByRole('button',{name:'Weekends',exact:true}).click();
  await editor.getByRole('button',{name:'Save period',exact:true}).click();
  await expect(editor.locator('.week-period-choice').filter({hasText:'Mid morning'})).toContainText('Weekends');
  expect((await api(actor,'week-periods/v2')).data.periods.find((p:any)=>p.label==='Mid morning').days).toEqual([5,6]);
  const device = await browser.newContext({baseURL: new URL(page.url()).origin});
  try {
    const other = await device.newPage();
    await loggedIn(other);
    await other.getByRole('button',{name:'Week',exact:true}).click();
    await other.getByText('Times of interest',{exact:true}).click();
    await expect(other.locator('.week-period-choice').filter({hasText:'Mid morning'})).toContainText('Weekends');
  } finally { await device.close(); }
});

});
