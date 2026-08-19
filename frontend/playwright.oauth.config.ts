import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.OAUTH_E2E_FRONTEND_URL || process.env.PLAYWRIGHT_BASE_URL;

if (!baseURL) {
  throw new Error("OAUTH_E2E_FRONTEND_URL is required for the OAuth E2E configuration.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/account-linking.spec.ts",
  // The configured accounts are real database fixtures. Run browser projects
  // serially so cleanup from one project cannot race another project's link.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],
});
