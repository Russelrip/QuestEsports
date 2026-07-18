import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3010";
const webServerPort = new URL(baseURL).port || "3010";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : [
      {
        command: "node scripts/mock-api.mjs",
        url: "http://127.0.0.1:5001/api/health/live",
        reuseExistingServer: false,
        timeout: 30 * 1000,
      },
      {
        command: `npm run start -- -p ${webServerPort}`,
        url: `${baseURL}/privacy-policy`,
        reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
        timeout: 120 * 1000,
      },
    ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
