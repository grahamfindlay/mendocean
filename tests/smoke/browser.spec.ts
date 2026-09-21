import { test, expect } from "@playwright/test";
test("production forecast renders and public navigation works", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Forecasts", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "History", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "My rows", exact: true })).toHaveCount(0);
  await expect(page.locator("main")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Today", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Now", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  // A rendered forecast must include actual conditions, not just the static shell.
  await expect(page.getByText("mph", { exact: false }).first()).toBeVisible();
  // Verify the deployed shell installs and controls the browser, including its asset hashes.
  const build = await page
    .locator('meta[name="mendocean-build"]')
    .getAttribute("content");
  expect(build).toBeTruthy();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<string | null>((resolve) => {
              const channel = new MessageChannel();
              const timer = setTimeout(() => {
                channel.port1.close();
                resolve(null);
              }, 1000);
              channel.port1.onmessage = (event) => {
                clearTimeout(timer);
                channel.port1.close();
                resolve(event.data.build);
              };
              navigator.serviceWorker.controller?.postMessage(
                { type: "GET_VERSION" },
                [channel.port2],
              );
            }),
        ),
      { timeout: 15000 },
    )
    .toBe(build);
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByText("mph", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Log", exact: true }).click();
  await expect(page.getByText("The pilot is invitation-only.")).toBeVisible();
  expect(errors).toEqual([]);
});
