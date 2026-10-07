import { test, expect } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import {
  user,
  cleanupUsers,
  localURL,
  secret,
  db,
  type Actor,
} from "../support/stack";
let actor: Actor;
// Requests handled by a service worker bypass Playwright routing. Block it in
// this SDK-only fixture; the separate upgrade suite covers real service workers.
test.use({ serviceWorkers: "block" });
test.beforeEach(async () => {
  actor = await user();
});
test.afterEach(async () => {
  await cleanupUsers([actor]);
});
test("real production SDK sanitizes private data and captures bundle frames; blocked analytics does not block use", async ({
  page,
  request,
}) => {
  const release = async (name: string) => {
    const r = await request.post("/__test/release", {
      headers: { "x-fixture-secret": secret },
      data: { release: name },
    });
    expect(r.ok()).toBe(true);
  };
  const events: any[] = [];
  await page.route("https://*.posthog.com/**", async (route) => {
    const body = route.request().postDataBuffer();
    if (body?.length) {
      let text = body.toString();
      if (body[0] === 31 && body[1] === 139) text = gunzipSync(body).toString();
      if (text.startsWith("data="))
        text = Buffer.from(
          new URLSearchParams(text).get("data")!,
          "base64",
        ).toString();
      const data = JSON.parse(text);
      events.push(...(Array.isArray(data) ? data : data.batch || [data]));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: 1, config: {} }),
    });
  });
  const { error: profileError } = await db
    .from("profiles")
    .update({ role: "admin", display_name: "Fixture Private Name" })
    .eq("id", actor.id);
  expect(profileError).toBeNull();
  const session = (await actor.client.auth.getSession()).data.session;
  const key = `sb-${new URL(localURL("TEST_SUPABASE_URL")).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(
    ({ key, session }) => {
      localStorage.setItem(key, JSON.stringify(session));
      // SDK bot filtering suppresses webdriver browsers; simulate human use only
      // in this local fixture, with every PostHog request intercepted.
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      const agent = navigator.userAgent.replace("HeadlessChrome", "Chrome");
      Object.defineProperty(navigator, "userAgent", { get: () => agent });
      Object.defineProperty(navigator, "userAgentData", {
        get: () => undefined,
      });
    },
    { key, session },
  );
  await release("telemetry");
  try {
    await page.goto("/?private=fixture-private-report&code=fixture-secret");
    await expect(
      page.getByRole("button", { name: "Account", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => events.some((e) => e.event === "app_opened"))
      .toBe(true);
    await page.goto("/admin/accounts");
    await expect(
      page.getByRole("button", { name: "Fixture Private Name", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(actor.email, { exact: true })).toBeVisible();
    await page.evaluate(() =>
      setTimeout(() => {
        (window as any).__MONITORING_FIXTURE__();
      }, 0),
    );
    await expect
      .poll(() => events.some((e) => e.event === "$exception"))
      .toBe(true);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("fixture-private-report");
    expect(serialized).not.toContain("fixture-secret");
    expect(serialized).not.toContain("fixture@example.test");
    expect(serialized).not.toContain(actor.email);
    expect(serialized).not.toContain("Fixture Private Name");
    expect(serialized).not.toContain("$current_url");
    const exception = events.find((e) => e.event === "$exception");
    expect(
      exception.properties.$exception_list[0].stacktrace.frames.some((f: any) =>
        f.filename.includes("/assets/"),
      ),
    ).toBe(true);
    expect(exception.properties.build).toContain("telemetry");
    expect(events.some((e) => e.properties?.distinct_id === actor.id)).toBe(
      true,
    );
    await page.unroute("https://*.posthog.com/**");
    await page.route("https://*.posthog.com/**", (route) => route.abort());
    await page.goto("/");
    await page.reload();
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your account", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Your name", { exact: true })).toBeVisible();
  } finally {
    await release("a");
  }
});
