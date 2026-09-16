import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.TEST_PREVIEW_PORT || 4173);
const previewURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "tests/browser",
  outputDir: "test-results/preview",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: previewURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "phone",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: previewURL,
    reuseExistingServer: false,
  },
});
