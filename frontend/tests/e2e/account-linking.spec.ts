import { expect, test, type Page } from "@playwright/test";
import type { BrowserContext, TestInfo } from "@playwright/test";

const apiUrl = process.env.OAUTH_E2E_API_URL || process.env.NEXT_PUBLIC_API_URL;
const frontendUrl = process.env.OAUTH_E2E_FRONTEND_URL || process.env.PLAYWRIGHT_BASE_URL;
const sessionCookieName = process.env.OAUTH_E2E_SESSION_COOKIE_NAME;

const requiredEnvironment = {
  OAUTH_E2E_API_URL: apiUrl,
  OAUTH_E2E_FRONTEND_URL: frontendUrl,
  OAUTH_E2E_RUN_ID: process.env.OAUTH_E2E_RUN_ID,
  OAUTH_E2E_LINK_EMAIL: process.env.OAUTH_E2E_LINK_EMAIL,
  OAUTH_E2E_LINK_PASSWORD: process.env.OAUTH_E2E_LINK_PASSWORD,
  OAUTH_E2E_COLLISION_EMAIL: process.env.OAUTH_E2E_COLLISION_EMAIL,
  OAUTH_E2E_COLLISION_PASSWORD: process.env.OAUTH_E2E_COLLISION_PASSWORD,
  OAUTH_E2E_COLLISION_OWNER_EMAIL: process.env.OAUTH_E2E_COLLISION_OWNER_EMAIL,
  OAUTH_E2E_COLLISION_OWNER_PASSWORD: process.env.OAUTH_E2E_COLLISION_OWNER_PASSWORD,
  OAUTH_E2E_COLLISION_PROVIDER_USER_ID: process.env.OAUTH_E2E_COLLISION_PROVIDER_USER_ID,
  OAUTH_E2E_LAST_METHOD_COOKIE: process.env.OAUTH_E2E_LAST_METHOD_COOKIE,
  OAUTH_E2E_SAFE_UNLINK_EMAIL: process.env.OAUTH_E2E_SAFE_UNLINK_EMAIL,
  OAUTH_E2E_SAFE_UNLINK_PASSWORD: process.env.OAUTH_E2E_SAFE_UNLINK_PASSWORD,
  OAUTH_E2E_SESSION_COOKIE_NAME: sessionCookieName,
};
const missingEnvironment = Object.entries(requiredEnvironment)
  .filter(([, value]) => !value)
  .map(([name]) => name);

const withOrigin = (origin: string) => ({
  Origin: origin,
  Referer: `${origin}/profile?tab=account`,
});

async function login(context: BrowserContext, email: string, password: string) {
  const response = await context.request.post(`${apiUrl}/api/login`, {
    data: { emailOrUsername: email, password, remember: true },
    headers: withOrigin(frontendUrl!),
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function getProviders(context: BrowserContext) {
  const response = await context.request.get(`${apiUrl}/api/v1/auth/oauth/providers`, {
    headers: withOrigin(frontendUrl!),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).providers as Array<{ provider: string; linked: boolean }>;
}

async function unlinkIfLinked(context: BrowserContext, provider: "google" | "discord") {
  const providers = await getProviders(context);
  if (!providers.find((entry) => entry.provider === provider)?.linked) return;

  const response = await context.request.delete(`${apiUrl}/api/v1/auth/oauth/${provider}`, {
    headers: withOrigin(frontendUrl!),
  });
  expect(response.ok(), await response.text()).toBe(true);
}

const providerName = (provider: "google" | "discord") =>
  provider[0].toUpperCase() + provider.slice(1);

async function linkThroughUi(page: Page, context: BrowserContext, provider: "google" | "discord") {
  const providers = await getProviders(context);
  if (providers.find((entry) => entry.provider === provider)?.linked) return;

  await openAccount(page);
  await page.getByRole("button", { name: `Link ${providerName(provider)}` }).click();
  await expect(page.getByRole("status")).toContainText("Account linked successfully");
  await expect(page.getByRole("button", { name: `Unlink ${providerName(provider)}` })).toBeVisible();
  expect((await getProviders(context)).find((entry) => entry.provider === provider)?.linked).toBe(true);
}

async function logout(context: BrowserContext) {
  await context.request.post(`${apiUrl}/api/logout`, {
    headers: withOrigin(frontendUrl!),
  });
}

async function runCleanup(actions: Array<() => Promise<void>>) {
  let firstError: unknown;
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      firstError ??= error;
    }
  }
  return firstError;
}

async function installSessionCookie(context: BrowserContext, rawCookie: string) {
  const cookie = rawCookie.split(";", 1)[0];
  const separator = cookie.indexOf("=");
  const value = separator < 0 ? cookie : cookie.slice(separator + 1);
  await context.addCookies([{
    name: sessionCookieName!,
    value,
    url: apiUrl!,
  }]);
}

async function sessionCookieValue(context: BrowserContext) {
  const cookie = (await context.cookies(apiUrl!)).find(
    (entry) => entry.name === sessionCookieName,
  );
  expect(cookie, `Expected ${sessionCookieName} session cookie`).toBeTruthy();
  return cookie!.value;
}

async function openAccount(page: Page) {
  await page.goto(`${frontendUrl}/profile?tab=account`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Linked accounts", exact: true })).toBeVisible({ timeout: 15_000 });
}

const projectDescription = (testInfo: TestInfo) =>
  `project=${testInfo.project.name}; run=${process.env.OAUTH_E2E_RUN_ID || "unknown"}`;

test.describe("OAuth account linking", () => {
  test.beforeEach(() => {
    test.skip(
      missingEnvironment.length > 0,
      `Missing required OAuth account-linking E2E environment: ${missingEnvironment.join(", ")}`,
    );
  });

  test("links a run-specific Google identity through the real provider boundary", async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "oauth-e2e", description: projectDescription(testInfo) });
    const context = page.context();
    await login(context, requiredEnvironment.OAUTH_E2E_LINK_EMAIL!, requiredEnvironment.OAUTH_E2E_LINK_PASSWORD!);
    const initiallyLinked = (await getProviders(context)).find((entry) => entry.provider === "google")?.linked === true;
    let testError: unknown;
    let cleanupError: unknown;

    try {
      expect(initiallyLinked).toBe(false);
      const sessionBefore = await sessionCookieValue(context);
      await openAccount(page);
      await page.getByRole("button", { name: "Link Google" }).click();
      await expect(page.getByRole("status")).toContainText("Account linked successfully");
      await expect(page.getByRole("button", { name: "Unlink Google" })).toBeVisible();
      expect(await sessionCookieValue(context)).toBe(sessionBefore);
      expect(page.url()).not.toMatch(/(?:code|state|providerId|access_token)=/i);
    } catch (error) {
      testError = error;
    } finally {
      cleanupError = await runCleanup([
        () => unlinkIfLinked(context, "google"),
        () => logout(context),
      ]);
    }

    if (testError !== undefined) throw testError;
    if (cleanupError !== undefined) throw cleanupError;
  });

  test("rejects a Discord identity independently owned by another account", async ({ page, browser }, testInfo) => {
    testInfo.annotations.push({ type: "oauth-e2e", description: projectDescription(testInfo) });
    const targetContext = page.context();
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await login(targetContext, requiredEnvironment.OAUTH_E2E_COLLISION_EMAIL!, requiredEnvironment.OAUTH_E2E_COLLISION_PASSWORD!);
    await login(ownerContext, requiredEnvironment.OAUTH_E2E_COLLISION_OWNER_EMAIL!, requiredEnvironment.OAUTH_E2E_COLLISION_OWNER_PASSWORD!);
    const targetInitiallyLinked = (await getProviders(targetContext)).find((entry) => entry.provider === "discord")?.linked === true;
    const ownerInitiallyLinked = (await getProviders(ownerContext)).find((entry) => entry.provider === "discord")?.linked === true;
    let testError: unknown;
    let cleanupError: unknown;
    try {
      expect(targetInitiallyLinked).toBe(false);
      expect(ownerInitiallyLinked).toBe(false);
      await linkThroughUi(ownerPage, ownerContext, "discord");

      await openAccount(page);
      await page.getByRole("button", { name: "Link Discord" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "could not link that account" })).toContainText("could not link that account");
      await expect(page.getByRole("button", { name: "Link Discord" })).toBeVisible();
      expect((await getProviders(targetContext)).find((entry) => entry.provider === "discord")?.linked).toBe(false);
      expect((await getProviders(ownerContext)).find((entry) => entry.provider === "discord")?.linked).toBe(true);
      expect(page.url()).not.toMatch(/(?:code|state|providerId|access_token)=/i);
    } catch (error) {
      testError = error;
    } finally {
      cleanupError = await runCleanup([
        () => unlinkIfLinked(ownerContext, "discord"),
        () => unlinkIfLinked(targetContext, "discord"),
        () => logout(targetContext),
        () => logout(ownerContext),
        () => ownerPage.close(),
        () => ownerContext.close(),
      ]);
    }

    if (testError !== undefined) throw testError;
    if (cleanupError !== undefined) throw cleanupError;
  });

  test("rejects unlinking the separately seeded last OAuth login method", async ({ page }) => {
    const context = page.context();
    try {
      await installSessionCookie(context, requiredEnvironment.OAUTH_E2E_LAST_METHOD_COOKIE!);
      await openAccount(page);

      await page.getByRole("button", { name: "Unlink Google" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Keep a verified password or another linked provider" })).toContainText("Keep a verified password or another linked provider");
      await expect(page.getByRole("button", { name: "Unlink Google" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("unlinks an OAuth provider when a verified password remains", async ({ page }) => {
    const context = page.context();
    await login(context, requiredEnvironment.OAUTH_E2E_SAFE_UNLINK_EMAIL!, requiredEnvironment.OAUTH_E2E_SAFE_UNLINK_PASSWORD!);
    const initiallyLinked = (await getProviders(context)).find((entry) => entry.provider === "google")?.linked === true;
    let testError: unknown;
    let cleanupError: unknown;

    try {
      expect(initiallyLinked).toBe(false);
      await linkThroughUi(page, context, "google");
      await page.getByRole("button", { name: "Unlink Google" }).click();
      await expect(page.getByRole("status")).toContainText("Google has been unlinked");
      await expect(page.getByRole("button", { name: "Link Google" })).toBeVisible();
    } catch (error) {
      testError = error;
    } finally {
      cleanupError = await runCleanup([
        () => unlinkIfLinked(context, "google"),
        () => logout(context),
      ]);
    }

    if (testError !== undefined) throw testError;
    if (cleanupError !== undefined) throw cleanupError;
  });
});
