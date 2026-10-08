import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, webkit, devices } from "@playwright/test";
import { assertStaging, query, root, secrets } from "./lib.mjs";
import { testSession } from "./smoke.mjs";

// Read-only fixture/UI checks. Safe with the owner's notification preferences on;
// never reset/publish/edit the practice or save attendance during this check.
export async function attendanceSmoke() {
  const c = await assertStaging(),
    s = secrets();
  const { client, session } = await testSession();
  const state = () =>
    query(
      `select
    (select jsonb_agg(jsonb_build_object('attendance',attendance,'reminder',reminder,'skipped',skipped,'deadline',deadline)) from public.outing_members where user_id='${session.user.id}') members,
    (select lineup_channels from public.profiles where id='${session.user.id}') preferences,
    (select jsonb_agg(jsonb_build_object('snapshot',snapshot,'version',version) order by outing_id) from private.lineup_snapshots where user_id='${session.user.id}') lineups,
    (select count(*) from private.lineup_events where user_id='${session.user.id}') events`,
      true,
    );
  const before = await state();
  try {
    const post = async (body, token = session.access_token) => {
      const response = await fetch(
        c.supabase_url + "/functions/v1/staging-test",
        {
          method: "POST",
          headers: {
            apikey: s.STAGING_SUPABASE_ANON_KEY,
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      return { response, data: await response.json() };
    };
    const request = {
      action: "attendance-roster",
      outing_id: "e746607c-f17f-4f59-833e-267f21fb7802",
    };
    const roster = await post(request);
    assert.equal(roster.response.status, 200);
    const names = roster.data.attendees.map((p) => p.name);
    assert(names.includes("Jordan Ellis"), "Unassigned attendee missing");
    assert(
      !names.includes("Graham Findlay") &&
        !names.includes("Pat Lee") &&
        !names.includes("Sam Avery"),
    );
    assert.equal(
      (await post(request, s.STAGING_SUPABASE_ANON_KEY)).response.status,
      401,
    );
    assert.equal(
      (
        await post({
          ...request,
          outing_id: "20000000-0000-4000-8000-000000000001",
        })
      ).response.status,
      400,
    );
    assert.equal(
      (
        await post({
          ...request,
          change: {
            attendance: "declined",
            expected: "attending",
            request_id: crypto.randomUUID(),
          },
        })
      ).response.status,
      400,
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
          {
            key: `sb-${c.supabase_ref}-auth-token`,
            session,
          },
        );
        await page.goto(c.app_url + "/?tab=Scheduled%20rows");
        await page
          .getByRole("button", { name: "Scheduled rows", exact: true })
          .click();
        for (const name of ["Attending", "Unknown", "Not attending"])
          await page.getByRole("checkbox", { name, exact: true }).check();
        const badge = page
          .getByRole("button", { name: /^Practice attendance:/ })
          .first();
        await badge.click();
        const dialog = page.getByRole("dialog");
        await dialog
          .getByRole("heading", { name: "Practice attendance" })
          .waitFor();
        const details = dialog.locator(".attendance-roster");
        assert.equal(await details.getAttribute("open"), null);
        await details.locator("summary").click();
        await details.getByText("Jordan Ellis", { exact: true }).waitFor();
        assert.deepEqual(
          await details.getByRole("listitem").allTextContents(),
          names,
        );
        await details
          .getByRole("button", { name: "Refresh attendees" })
          .click();
        await details
          .getByRole("button", { name: "Refresh attendees" })
          .waitFor({ state: "visible" });
        await page.waitForFunction(
          () => !document.querySelector(".attendance-roster button")?.disabled,
        );
        assert.deepEqual(
          await details.getByRole("listitem").allTextContents(),
          names,
        );
        for (const width of [320, 390, 430]) {
          await page.setViewportSize({ width, height: 844 });
          assert(
            await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
            "Attendance modal overflows",
          );
        }
        await page.setViewportSize({ width: 390, height: 844 });
        mkdirSync(resolve(root, "test-results"), { recursive: true });
        await page.screenshot({
          path: resolve(root, `test-results/staging-attendance-${label}.png`),
        });
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
        assert.equal(errors.length, 0);
        console.log(
          `${label}: hosted attendance modal, lazy expansion, refresh and narrow-phone layout passed.`,
        );
        await context.close();
      } finally {
        await browser.close();
      }
    }
    assert.deepEqual(
      await state(),
      before,
      "Read-only attendance checks changed staging state",
    );
    console.log(
      "Staging attendance access checks passed; memberships, lineups, preferences and event counts preserved. No email or notifications sent by these checks.",
    );
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}
