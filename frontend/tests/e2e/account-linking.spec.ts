import { expect, test, type Page } from "./test-fixture";
import type { BrowserContext } from "@playwright/test";

const apiUrl = process.env.OAUTH_E2E_API_URL || process.env.NEXT_PUBLIC_API_URL;
const frontendUrl = process.env.OAUTH_E2E_FRONTEND_URL || process.env.PLAYWRIGHT_BASE_URL;
const requiredEnvironment = {
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  OAUTH_E2E_API_URL: apiUrl,
  OAUTH_E2E_FRONTEND_URL: frontendUrl,
  OAUTH_E2E_LINK_EMAIL: process.env.OAUTH_E2E_LINK_EMAIL,
  OAUTH_E2E_LINK_PASSWORD: process.env.OAUTH_E2E_LINK_PASSWORD,
  OAUTH_E2E_COLLISION_EMAIL: process.env.OAUTH_E2E_COLLISION_EMAIL,
  OAUTH_E2E_COLLISION_PASSWORD: process.env.OAUTH_E2E_COLLISION_PASSWORD,
  OAUTH_E2E_LAST_METHOD_COOKIE: process.env.OAUTH_E2E_LAST_METHOD_COOKIE,
  OAUTH_E2E_SAFE_UNLINK_EMAIL: process.env.OAUTH_E2E_SAFE_UNLINK_EMAIL,
  OAUTH_E2E_SAFE_UNLINK_PASSWORD: process.env.OAUTH_E2E_SAFE_UNLINK_PASSWORD,
  OAUTH_E2E_SESSION_COOKIE_NAME: process.env.OAUTH_E2E_SESSION_COOKIE_NAME,
  OAUTH_E2E_GOOGLE_CODE: process.env.OAUTH_E2E_GOOGLE_CODE,
  OAUTH_E2E_DISCORD_COLLISION_CODE: process.env.OAUTH_E2E_DISCORD_COLLISION_CODE,
};
const missingEnvironment = Object.entries(requiredEnvironment)
  .filter(([, value]) => !value)
  .map(([name]) => name);

const withOrigin = (origin: string) => ({ Origin: origin, Referer: `${origin}/profile?tab=account` });

async function login(context: BrowserContext, email: string, password: string) {
  const response = await context.request.post(`${apiUrl}/api/login`, {
    data: { emailOrUsername: email, password, remember: true },
    headers: withOrigin(frontendUrl!),
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function installSessionCookie(context: BrowserContext, rawCookie: string) {
  const separator = rawCookie.indexOf("=");
  const value = separator < 0 ? rawCookie : rawCookie.slice(separator + 1);
  await context.addCookies([{
    name: process.env.OAUTH_E2E_SESSION_COOKIE_NAME!,
    value,
    url: apiUrl!,
  }]);
}

/**
 * This is the only browser boundary mocked by these tests. The profile page,
 * provider list, link callback, and unlink request all go to the real API.
 * The configured authorization codes are supplied by the provider test
 * fixture, so no provider identity, token, or account API is fabricated here.
 */
async function mockProviderBoundary(context: BrowserContext, provider: "google" | "discord", code: string) {
  const authorizationPattern = provider === "google"
    ? "https://accounts.google.com/o/oauth2/v2/auth**"
    : "https://discord.com/api/oauth2/authorize**";

  await context.route(authorizationPattern, async (route) => {
    const authorization = new URL(route.request().url());
    const redirectUri = authorization.searchParams.get("redirect_uri");
    const state = authorization.searchParams.get("state");
    expect(redirectUri).toBeTruthy();
    expect(state).toBeTruthy();

    const callback = new URL(redirectUri!);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state!);
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<script>window.location.replace(${JSON.stringify(callback.href)});</script>`,
    });
  });
}

async function openAccount(page: Page) {
  await page.goto(`${frontendUrl}/profile?tab=account`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Linked accounts" })).toBeVisible();
}

test.describe("OAuth account linking", () => {
  test.beforeEach(() => {
    test.skip(
      missingEnvironment.length > 0,
      `Missing required OAuth account-linking E2E environment: ${missingEnvironment.join(", ")}`,
    );
  });

  test("links Google through the real profile and account API", async ({ page }) => {
    await login(page.context(), requiredEnvironment.OAUTH_E2E_LINK_EMAIL!, requiredEnvironment.OAUTH_E2E_LINK_PASSWORD!);
    await mockProviderBoundary(page.context(), "google", requiredEnvironment.OAUTH_E2E_GOOGLE_CODE!);
    await openAccount(page);

    await page.getByRole("button", { name: "Link Google" }).click();
    await expect(page.getByRole("status")).toContainText("Account linked successfully");
    await expect(page.getByRole("button", { name: "Unlink Google" })).toBeVisible();
    expect(page.url()).not.toMatch(/(?:code|state|providerId|access_token)=/i);
  });

  test("reports a Discord provider collision without changing the profile", async ({ page }) => {
    await login(page.context(), requiredEnvironment.OAUTH_E2E_COLLISION_EMAIL!, requiredEnvironment.OAUTH_E2E_COLLISION_PASSWORD!);
    await mockProviderBoundary(page.context(), "discord", requiredEnvironment.OAUTH_E2E_DISCORD_COLLISION_CODE!);
    await openAccount(page);

    await page.getByRole("button", { name: "Link Discord" }).click();
    await expect(page.getByRole("alert")).toContainText("could not link that account");
    await expect(page.getByRole("button", { name: "Link Discord" })).toBeVisible();
    expect(page.url()).not.toMatch(/(?:code|state|providerId|access_token)=/i);
  });

  test("rejects unlinking the last OAuth login method", async ({ page }) => {
    await installSessionCookie(page.context(), requiredEnvironment.OAUTH_E2E_LAST_METHOD_COOKIE!);
    await openAccount(page);

    await page.getByRole("button", { name: "Unlink Google" }).click();
    await expect(page.getByRole("alert")).toContainText("Keep a verified password or another linked provider");
    await expect(page.getByRole("button", { name: "Unlink Google" })).toBeVisible();
  });

  test("unlinks an OAuth provider when a verified password remains", async ({ page }) => {
    await login(page.context(), requiredEnvironment.OAUTH_E2E_SAFE_UNLINK_EMAIL!, requiredEnvironment.OAUTH_E2E_SAFE_UNLINK_PASSWORD!);
    await openAccount(page);

    await page.getByRole("button", { name: "Unlink Google" }).click();
    await expect(page.getByRole("status")).toContainText("Google has been unlinked");
    await expect(page.getByRole("button", { name: "Link Google" })).toBeVisible();
  });
});
