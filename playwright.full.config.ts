import { defineConfig, devices } from "@playwright/test";
if (process.env.TEST_STACK !== "local-only")
  throw new Error("Full-stack browser tests require the isolated harness");
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  maxFailures: 5,
  timeout: 45000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: { baseURL: process.env.TEST_APP_URL, trace: "off", screenshot: "off" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    {
      name: "mobile-chromium-emulation",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
