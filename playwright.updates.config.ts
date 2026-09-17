import { defineConfig, devices } from "@playwright/test";
if (process.env.TEST_STACK !== "local-only")
  throw new Error("Update tests require the isolated harness");
export default defineConfig({
  testDir: "tests/updates",
  outputDir: "test-results/updates",
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 12000 },
  reporter: "list",
  use: { baseURL: process.env.TEST_APP_URL, trace: "off", screenshot: "off" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
