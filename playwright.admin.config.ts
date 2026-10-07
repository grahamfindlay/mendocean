import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.TEST_ADMIN_PORT || 4181);
const url = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "tests/admin-browser",
  outputDir: "test-results/admin",
  fullyParallel: true,
  use: { baseURL: url, serviceWorkers: "block", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "phone",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
    {
      name: "phone-webkit",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url,
    reuseExistingServer: false,
    // All API requests use a synthetic origin and are intercepted by the tests.
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_ANON_KEY: "fixture-public-key",
      VITE_TELEMETRY_ENABLED: "false",
    },
  },
});
