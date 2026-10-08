import { chromium, webkit, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { assertStaging, query, root } from "./lib.mjs";
import { testSession } from "./smoke.mjs";
export async function browserSmoke() {
  const c = await assertStaging();
  const { client, session } = await testSession();
  try {
    const [profile] = await query(
      "select lineup_channels from public.profiles where id='" +
        session.user.id +
        "'",
      true,
    );
    if (profile.lineup_channels?.length)
      throw new Error(
        "Browser smoke requires notification preferences off to avoid sending.",
      );
    for (const [type, label] of [
      [chromium, "chromium"],
      [webkit, "webkit"],
    ]) {
      const browser = await type.launch();
      try {
        const context = await browser.newContext(devices["iPhone 13"]);
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", () => errors.push("pageerror"));
        await page.addInitScript(
          ({ key, session }) =>
            localStorage.setItem(key, JSON.stringify(session)),
          { key: `sb-${c.supabase_ref}-auth-token`, session },
        );
        await page.goto(c.app_url + "/?tab=Lineups");
        await page
          .getByRole("heading", { name: "Lineups", exact: true })
          .waitFor();
        await page.locator(".lineup-you").waitFor();
        await page
          .getByRole("button", { name: "Account", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Reset to unpublished", exact: true })
          .click();
        await page
          .getByText(
            "Lineup updated. Enable and save lineup email/push preferences to receive notifications.",
            { exact: true },
          )
          .waitFor();
        await page
          .getByRole("button", { name: "Publish lineup", exact: true })
          .click();
        await page
          .getByText(
            "Lineup updated. Enable and save lineup email/push preferences to receive notifications.",
            { exact: true },
          )
          .waitFor();
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page.locator(".lineup-you").waitFor();
        await page.reload();
        await page.locator(".lineup-you").waitFor();
        if (
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          )
        )
          throw new Error("Staging mobile layout overflows.");
        if (errors.length)
          throw new Error("Staging browser emitted a page error.");
        mkdirSync(resolve(root, "test-results"), { recursive: true });
        await page.screenshot({
          path: resolve(root, `test-results/staging-${label}.png`),
          fullPage: true,
        });
        console.log(
          label + " hosted mobile browser, test controls and reload passed.",
        );
        await context.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}
