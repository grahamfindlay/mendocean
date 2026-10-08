import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, webkit, devices } from "@playwright/test";
import { assertStaging, literal, query, root, secrets } from "./lib.mjs";
import { testSession } from "./smoke.mjs";

const outingId = "c68221b7-f064-4b4d-aec5-4b616329925e";
const title = "Upcoming attendance test";
const existingState = () =>
  query(
    `select
 (select jsonb_agg(to_jsonb(o) order by id) from public.outings o where id<>${literal(outingId)}) outings,
 (select jsonb_agg(to_jsonb(m) order by user_id,outing_id) from public.outing_members m where outing_id<>${literal(outingId)}) members,
 (select jsonb_agg(md5(to_jsonb(c)::text) order by user_id) from private.bhc_connections c) connections,
 (select jsonb_agg(jsonb_build_object('id',id,'channels',lineup_channels,'changes',lineup_changes) order by id) from public.profiles) preferences,
 (select jsonb_agg(to_jsonb(l) order by user_id,outing_id) from private.lineup_snapshots l) lineups,
 (select count(*) from private.lineup_events) events`,
    true,
  );

export async function prepareAttendanceFixture() {
  await assertStaging();
  const s = secrets();
  const before = await existingState();
  const result = await query(
    `begin;\n${readFileSync(resolve(root, "scripts/staging/attendance-fixture.sql"), "utf8")}\nselect public.staging_attendance_fixture(${literal(s.STAGING_OWNER_ID)}) fixture;\ncommit;`,
  );
  assert.deepEqual(
    await existingState(),
    before,
    "Attendance setup changed an existing practice, lineup, connection or notification preference",
  );
  console.log(JSON.stringify(result));
  console.log(
    "Separate upcoming practice prepared with an open signup deadline and no lineup history. Existing lineup scenario preserved.",
  );
}

async function assertUnpublishedFixture(uid) {
  const [fixture] = await query(
    `select o.starts_at,m.deadline,
    (select count(*) from private.lineup_snapshots where outing_id=o.id) snapshots,
    (select count(*) from private.lineup_events where outing_id=o.id) events
    from public.outings o join public.outing_members m on m.outing_id=o.id
    where o.id=${literal(outingId)} and m.user_id=${literal(uid)}`,
    true,
  );
  assert(fixture, "Run attendance-fixture first");
  assert(
    Date.parse(fixture.starts_at) > Date.now(),
    "Test practice must be upcoming; rerun attendance-fixture",
  );
  assert(
    Date.parse(fixture.deadline) > Date.now(),
    "Signup deadline must be open; rerun attendance-fixture",
  );
  assert(Date.parse(fixture.deadline) < Date.parse(fixture.starts_at));
  assert.equal(
    Number(fixture.snapshots),
    0,
    "Test practice has a lineup snapshot",
  );
  assert.equal(
    Number(fixture.events),
    0,
    "Test practice has a publication event",
  );
}

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
    await assertUnpublishedFixture(session.user.id);
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
      outing_id: outingId,
    };
    const roster = await post(request);
    assert.equal(roster.response.status, 200);
    const names = roster.data.attendees.map((p) => p.name);
    assert(names.includes("Jordan Ellis"), "Unassigned attendee missing");
    assert.deepEqual(names, [
      "Jordan Ellis",
      "Micah Rivera",
      "Nora Sullivan",
      "Polyanna Nunes Da Silva",
    ]);
    const status = await post({ action: "attendance", outing_id: outingId });
    assert.equal(status.response.status, 200);
    assert.equal(status.data.state.allowed, true);
    assert(Date.parse(status.data.state.deadline) > Date.now());
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
        let rosterReads = 0;
        page.on("request", (request) => {
          if (
            request.url().endsWith("/functions/v1/staging-test") &&
            request.postDataJSON()?.action === "attendance-roster"
          )
            rosterReads++;
        });
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
        const card = page.locator(".scheduled-row-entry").filter({
          has: page.getByRole("button", { name: new RegExp(title) }),
        });
        assert.equal(
          await card.getByRole("button", { name: /Lineup/ }).count(),
          0,
        );
        const badge = card.getByRole("button", {
          name: /^Practice attendance:/,
        });
        await badge.click();
        const dialog = page.getByRole("dialog");
        await dialog
          .getByRole("heading", { name: "Practice attendance" })
          .waitFor();
        await dialog.getByLabel("Your attendance").waitFor();
        await page.waitForFunction(() => {
          const select = document.querySelector(
            'select[aria-label="Your attendance"]',
          );
          return select && !select.disabled;
        });
        assert.equal(
          await dialog.getByLabel("Your attendance").isDisabled(),
          false,
        );
        assert.equal(
          await dialog
            .getByText("The attendance deadline has passed.", { exact: true })
            .count(),
          0,
        );
        assert.equal(rosterReads, 0, "Roster fetched before expansion");
        const details = dialog.locator(".attendance-roster");
        assert.equal(await details.getAttribute("open"), null);
        await details.locator("summary").click();
        await details.getByText("Jordan Ellis", { exact: true }).waitFor();
        assert.equal(rosterReads, 1);
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
        assert.equal(
          rosterReads,
          2,
          "Refresh must make another roster request",
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
    await assertUnpublishedFixture(session.user.id);
    console.log(
      "Staging attendance access checks passed; memberships, lineups, preferences and event counts preserved. No email or notifications sent by these checks.",
    );
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}
