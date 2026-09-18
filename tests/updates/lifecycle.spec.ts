import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, chromium, type Page } from "@playwright/test";
import {
  user,
  practice,
  tick,
  cleanupUsers,
  ensureWeather,
  sql,
  api,
  fixtures,
  syntheticToken,
  localURL,
  secret,
  type Actor,
} from "../support/stack";
let actor: Actor;
let browserErrors: string[] = [];
const unfinished = new Set<import("@playwright/test").Request>();
async function release(name: "a" | "b" | "c" | "legacy", failure?: string) {
  const r = await fetch(localURL("TEST_APP_URL") + "/__test/release", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-fixture-secret": secret },
    body: JSON.stringify({ release: name, failure }),
  });
  expect(r.ok).toBe(true);
  return (await r.json()).build as string;
}
const build = (page: Page) => page.locator('meta[name="mendocean-build"]');
async function controlled(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((ok) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => ok(),
          { once: true },
        ),
      );
  });
}
async function foreground(page: Page, minutes: number) {
  await page.clock.setFixedTime(Date.now() + minutes * 61000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
async function signedIn(page: Page) {
  const { data } = await actor.client.auth.getSession();
  await page.addInitScript(
    ({ key, value }) => {
      if (!sessionStorage.getItem("update-test-session-seeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("update-test-session-seeded", "yes");
      }
    },
    { key: "sb-127-auth-token", value: JSON.stringify(data.session) },
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Account", exact: true }),
  ).toBeVisible();
  await controlled(page);
}
async function check(page: Page) {
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
}
const banner = (page: Page) =>
  page.getByRole("complementary", { name: "App update" });
async function closeAccount(page: Page) {
  await page.getByRole("button", { name: "Close", exact: true }).click();
}
async function log(page: Page) {
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "How was the water?" }),
  ).toBeVisible();
}
test.beforeAll(async () => {
  await ensureWeather();
});
test.beforeEach(async ({ context, page }) => {
  browserErrors = [];
  unfinished.clear();
  context.on("request", (req) => unfinished.add(req));
  context.on("requestfinished", (req) => unfinished.delete(req));
  context.on("requestfailed", (req) => unfinished.delete(req));
  await context.route(
    /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
    (route) => route.abort(),
  );
  page.on("pageerror", (error) => browserErrors.push(error.message));
  context.on("page", (newPage) =>
    newPage.on("pageerror", (error) => browserErrors.push(error.message)),
  );
  await context.addInitScript(() => {
    navigator.serviceWorker?.addEventListener("message", (event) => {
      const messages = JSON.parse(
        sessionStorage.getItem("update-test-messages") || "[]",
      );
      messages.push({ type: event.data?.type, build: event.data?.build });
      sessionStorage.setItem("update-test-messages", JSON.stringify(messages));
    });
  });
  await release("a");
  actor = await user();
});
test.afterEach(async ({ context }, info) => {
  if (info.status !== info.expectedStatus)
    console.log(
      "Pending request paths",
      [...unfinished].map(
        (req) => new URL(req.url()).origin + new URL(req.url()).pathname,
      ),
    );
  if (info.status !== info.expectedStatus)
    for (const page of context.pages()) {
      console.log(
        "Update diagnostics",
        await page
          .evaluate(async () => {
            const registration =
              await navigator.serviceWorker.getRegistration();
            const debugWorker = (worker: ServiceWorker | null | undefined) =>
              new Promise((resolve) => {
                const channel = new MessageChannel();
                const timer = setTimeout(
                  () => resolve("No active worker response"),
                  500,
                );
                channel.port1.onmessage = (event) => {
                  clearTimeout(timer);
                  channel.port1.close();
                  resolve(event.data);
                };
                worker?.postMessage({ type: "GET_VERSION" }, [channel.port2]);
              });
            const debug = await debugWorker(registration?.active);
            const waitingDebug = await debugWorker(registration?.waiting);
            return {
              debug,
              waitingDebug,
              html: document
                .querySelector('meta[name="mendocean-build"]')
                ?.getAttribute("content"),
              active: registration?.active?.state,
              waiting: registration?.waiting?.state,
              controller: navigator.serviceWorker.controller?.state,
              messages: sessionStorage.getItem("update-test-messages"),
              banner: document.querySelector(".app-update")?.textContent,
            };
          })
          .catch(() => "Page unavailable"),
      );
    }
  await fixtures({ hold_attendance: false });
  await cleanupUsers([actor]);
  // WebKit also emits pageerror for intentionally failed/aborted network requests.
  const expectedTransportFailures =
    info.project.name === "webkit" && info.title.startsWith("corrupt asset");
  expect(
    browserErrors.filter(
      (error) =>
        !(
          expectedTransportFailures &&
          /^\/127\.0\.0\.1:(4175|54321)\/.* due to access control checks\.$/.test(
            error,
          )
        ),
    ),
  ).toEqual([]);
});
test.afterAll(async () => {
  await sql.end();
});

test("first install, signed-out foreground A→B→C, no reload loop, coherent offline shell", async ({
  page,
  context,
}, info) => {
  const a = await release("a");
  let navigations = 0;
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navigations++;
  });
  await page.goto("/");
  await controlled(page);
  await expect(build(page)).toHaveAttribute("content", a);
  expect(navigations).toBe(1);
  const b = await release("b");
  await foreground(page, 1);
  await expect(build(page)).toHaveAttribute("content", b);
  await expect(
    page.getByRole("img", { name: /^Wind from/ }).first(),
  ).toBeVisible();
  const c = await release("c");
  await foreground(page, 2);
  await expect(build(page)).toHaveAttribute("content", c);
  await foreground(page, 3);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  expect(navigations).toBe(3);
  if (info.project.name === "chromium") {
    await context.setOffline(true);
    await page.reload();
  } else
    info.annotations.push({
      type: "coverage",
      description:
        "Offline navigation is tested in Chromium; a minimal cached-shell probe fails in Playwright WebKit on macOS.",
    });
  await expect(build(page)).toHaveAttribute("content", c);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("manual upgrade waits for another tab's draft; session, BHC and registration survive", async ({
  page,
  context,
}) => {
  await fixtures({ bhc: [], lineup: false });
  expect(
    (await api(actor, "bhc/connect", { token: syntheticToken })).status,
  ).toBe(200);
  await context.addInitScript(() => {
    const forbidden = () => {
      localStorage.setItem("update-registration-reset", "yes");
      return Promise.reject(new Error("An update must not reset registration"));
    };
    if ("ServiceWorkerRegistration" in window)
      ServiceWorkerRegistration.prototype.unregister = forbidden;
    if ("PushSubscription" in window)
      PushSubscription.prototype.unsubscribe = forbidden;
  });
  await signedIn(page);
  const before = await page.evaluate(() =>
    localStorage.getItem("sb-127-auth-token"),
  );
  const other = await context.newPage();
  await other.goto("/");
  await controlled(other);
  await log(other);
  await other.locator("details.form-card > summary").click();
  await other.getByLabel("Anything else?").fill("Keep this unfinished draft");
  const b = await release("b");
  await check(page);
  await expect(
    banner(page).getByRole("button", { name: "Update now" }),
  ).toBeDisabled();
  await closeAccount(page);
  await banner(page).getByRole("button", { name: "Update now" }).click();
  await expect(banner(page)).toContainText("other Mendocean windows");
  await expect(other.getByLabel("Anything else?")).toHaveValue(
    "Keep this unfinished draft",
  );
  // The last edit and navigation occur faster than the normal autosave delay.
  await other.getByLabel("Anything else?").fill("Latest draft keystroke");
  await other.getByRole("button", { name: "Forecasts", exact: true }).click();
  await banner(page).getByRole("button", { name: "Update now" }).click();
  await expect(build(page)).toHaveAttribute("content", b);
  await expect(build(other)).toHaveAttribute("content", b);
  await expect(
    page.getByRole("button", { name: "Account", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("sb-127-auth-token")),
  ).toBe(before);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("update-registration-reset"),
    ),
  ).toBeNull();
  const account = (await api(actor, "account")).data;
  expect(account.bhc.connected).toBe(true);
  await log(other);
  await other.locator("details.form-card > summary").click();
  await expect(other.getByLabel("Anything else?")).toHaveValue(
    "Latest draft keystroke",
  );
  await other.close();
});

test("corrupt asset and failed update check retain old shell; retry installs a complete release", async ({
  page,
  context,
}, info) => {
  const a = await release("a");
  await signedIn(page);
  await release("b", "asset");
  await check(page);
  await expect(
    page.getByRole("region", { name: "App version and updates" }),
  ).toContainText("complete update could not be downloaded");
  await closeAccount(page);
  // Set the next outage before navigation triggers a background update check.
  // Otherwise an in-flight retry can receive B's script during the asset outage,
  // then valid assets after the fixture switches to the worker-only outage.
  await release("b", "worker");
  if (info.project.name === "chromium") await context.setOffline(true);
  await page.reload();
  await expect(build(page)).toHaveAttribute("content", a);
  await context.setOffline(false);
  await check(page);
  await expect(
    page
      .getByRole("region", { name: "App version and updates" })
      .getByRole("button", { name: "Check for updates" }),
  ).toBeEnabled();
  await expect(build(page)).toHaveAttribute("content", a);
  // build.json is diagnostic; a metadata failure must not block a verified worker.
  const b = await release("b", "metadata");
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await expect(banner(page)).toContainText("Update available");
  await closeAccount(page);
  await banner(page).getByRole("button", { name: "Update now" }).click();
  await expect(build(page)).toHaveAttribute("content", b);
  if (info.project.name === "chromium") await context.setOffline(true);
  await page.reload();
  await expect(build(page)).toHaveAttribute("content", b);
});

test("a ready update preserves an offline report and uploads it exactly once after reconnect", async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Playwright WebKit fails even minimal SW-cached offline navigation; covered in Chromium and pending on the installed iPhone.",
  );
  await signedIn(page);
  const b = await release("b");
  await check(page);
  await expect(banner(page)).toContainText("Update available");
  await closeAccount(page);
  await log(page);
  await page
    .getByRole("button", { name: "Stayed ashore", exact: true })
    .click();
  await page.getByLabel("What kept you ashore?").selectOption("wind_waves");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(page.getByText("On this device · 1 pending")).toBeVisible();
  await banner(page).getByRole("button", { name: "Update now" }).click();
  await expect(build(page)).toHaveAttribute("content", b);
  await expect(page.getByText("On this device · 1 pending")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("On this device · 1 pending")).toHaveCount(0);
  const reports = async () =>
    (await api(actor, "account")).data.outings.flatMap((o: any) => o.reports);
  await expect.poll(async () => (await reports()).length).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Account", exact: true }),
  ).toBeVisible();
  expect((await reports()).length).toBe(1);
  await log(page);
  await expect(
    page.getByText("Your unfinished draft was restored from this device."),
  ).toHaveCount(0);
});

test("an existing-report edit remains untouched by an update discovered during use", async ({
  page,
}) => {
  await signedIn(page);
  await log(page);
  await page.getByRole("button", { name: "2 Good", exact: true }).click();
  await page.getByRole("button", { name: "East", exact: true }).click();
  await page.route(
    "**/functions/v1/api/report",
    async (route) => {
      // A slow upload outlasts the draft debounce; it must not recreate a saved draft.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit report", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (userId) =>
        new Promise((resolve) => {
          const request = indexedDB.open("mendocean-private", 1);
          request.onsuccess = () => {
            const database = request.result;
            const read = database
              .transaction("drafts")
              .objectStore("drafts")
              .get(userId);
            read.onsuccess = () => {
              database.close();
              resolve(read.result);
            };
          };
        }),
      actor.id,
    ),
  ).toBeUndefined();
  await page.getByRole("button", { name: "Edit report", exact: true }).click();
  await page.getByRole("button", { name: "3 Fine", exact: true }).click();
  await release("b");
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.ready).update();
  });
  await expect(
    banner(page).getByRole("button", { name: "Update now" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "3 Fine", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("3 · Fine · east")).toBeVisible();
  await banner(page).getByRole("button", { name: "Update now" }).click();
  await expect(build(page)).toHaveAttribute("content", await release("b"));
  await expect(page.getByText("3 · Fine · east")).toBeVisible();
});

test("attendance submission finishes before activation, without a second BHC write", async ({
  page,
}) => {
  const p = {
    ...practice(9000000 + Math.floor(Math.random() * 100000), "unknown"),
    start_time: Math.floor(Date.now() / 1000) + 86400,
    end_time: Math.floor(Date.now() / 1000) + 90000,
    attendance_window_start: Math.floor(Date.now() / 1000) - 3600,
    attendance_window_end: Math.floor(Date.now() / 1000) + 3600,
    set_attendance_allowed: true,
  };
  await fixtures({ bhc: [p], failure: null, calls: [] });
  await api(actor, "bhc/connect", { token: syntheticToken });
  await tick();
  await signedIn(page);
  await page.getByRole("button", { name: "My rows", exact: true }).click();
  await page
    .getByRole("button", { name: "Change attendance", exact: true })
    .click();
  await expect(page.getByText("Status checked with BHC.")).toBeVisible();
  await fixtures({ hold_attendance: true });
  await page.getByLabel("Your attendance").selectOption("attending");
  await page.getByRole("button", { name: "Save attendance in BHC" }).click();
  await expect
    .poll(async () =>
      (await fixtures()).calls.some(
        (c: any) => c.path === "/practices/setAttendance",
      ),
    )
    .toBe(true);
  const b = await release("b");
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.ready).update();
  });
  await expect(
    banner(page).getByRole("button", { name: "Update now" }),
  ).toBeDisabled();
  await fixtures({ hold_attendance: false });
  await expect(page.getByText("Attendance updated in BHC.")).toBeVisible();
  // Confirmation precedes the account refresh; the editor cannot close until it finishes.
  await expect(
    page.getByText("Checking with BHC…", { exact: true }),
  ).toHaveCount(0);
  await closeAccount(page);
  await banner(page).getByRole("button", { name: "Update now" }).click();
  await expect(build(page)).toHaveAttribute("content", b);
  await expect(page.locator(".attendance-badge")).toHaveText("Attending");
  expect(
    (await fixtures()).calls.filter(
      (c: any) => c.path === "/practices/setAttendance",
    ),
  ).toHaveLength(1);
});

test("one persistent profile upgrades on reopen and retains sign-in offline", async ({}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Persistent browser restart is covered in Chromium; installed iOS remains device acceptance.",
  );
  const profile = await mkdtemp(
    join(process.env.TEST_PROFILE_ROOT!, "upgrade-browser-"),
  );
  const options = { headless: true, baseURL: process.env.TEST_APP_URL };
  let context = await chromium.launchPersistentContext(profile, options);
  try {
    await signedIn(context.pages()[0]);
    await context.close();
    const b = await release("b");
    context = await chromium.launchPersistentContext(profile, options);
    let page = context.pages()[0];
    await page.goto("/");
    await expect(build(page)).toHaveAttribute("content", b);
    await expect(
      page.getByRole("button", { name: "Account", exact: true }),
    ).toBeVisible();
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      ...options,
      offline: true,
    });
    page = context.pages()[0];
    await page.goto("/");
    await expect(build(page)).toHaveAttribute("content", b);
    await expect(
      page.getByRole("button", { name: "Account", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("an online navigation from the legacy worker completes installation without an extra reload", async ({
  page,
}) => {
  await release("legacy");
  await page.goto("/");
  await controlled(page);
  const b = await release("b");
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  // The existing header is a normal navigation, as recommended for bootstrapping.
  await page.getByRole("link", { name: /mendocean LAKE MENDOTA/ }).click();
  await expect(build(page)).toHaveAttribute("content", b);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string | null>((resolve) => {
            const channel = new MessageChannel();
            const timeout = setTimeout(() => resolve(null), 500);
            channel.port1.onmessage = (event) => {
              clearTimeout(timeout);
              channel.port1.close();
              resolve(event.data.build);
            };
            navigator.serviceWorker.controller?.postMessage(
              { type: "GET_VERSION" },
              [channel.port2],
            );
          }),
      ),
    )
    .toBe(b);
  expect(navigations).toBe(1);
  await expect(banner(page)).toHaveCount(0);
});
