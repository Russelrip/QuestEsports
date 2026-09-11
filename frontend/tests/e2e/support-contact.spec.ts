import { expect, test } from "./test-fixture";
import type { BrowserContext, APIRequestContext } from "@playwright/test";

const apiUrl = process.env.SUPPORT_E2E_API_URL || process.env.NEXT_PUBLIC_API_URL;
const frontendUrl = process.env.SUPPORT_E2E_FRONTEND_URL || process.env.PLAYWRIGHT_BASE_URL;
const requiredEnvironment = {
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  SUPPORT_E2E_API_URL: apiUrl,
  SUPPORT_E2E_FRONTEND_URL: frontendUrl,
  SUPPORT_E2E_USER_EMAIL: process.env.SUPPORT_E2E_USER_EMAIL,
  SUPPORT_E2E_USER_PASSWORD: process.env.SUPPORT_E2E_USER_PASSWORD,
  E2E_ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD,
};
const missingEnvironment = Object.entries(requiredEnvironment)
  .filter(([, value]) => !value)
  .map(([name]) => name);

const withOrigin = (origin: string) => ({ Origin: origin, Referer: `${origin}/support` });

async function login(context: BrowserContext, email: string, password: string, origin: string) {
  const response = await context.request.post(`${apiUrl}/api/login`, {
    data: { emailOrUsername: email, password, remember: true },
    headers: withOrigin(origin),
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function readJson(request: APIRequestContext, path: string, origin: string) {
  const response = await request.get(`${apiUrl}${path}`, { headers: withOrigin(origin) });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<{ success: true; data: { items: Array<{ id: string; subject?: string; type?: string; actionUrl?: string | null; body?: string; unreadCount?: number }>; unreadCount?: number } }>;
}

async function stubRealtimeBoundary(context: BrowserContext) {
  await context.addInitScript(() => {
    class TestEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = TestEventSource.CONNECTING;
      readonly OPEN = TestEventSource.OPEN;
      readonly CLOSED = TestEventSource.CLOSED;
      readonly readyState = TestEventSource.CLOSED;
      readonly url: string;
      readonly withCredentials: boolean;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;

      constructor(url: string | URL, init?: EventSourceInit) {
        super();
        this.url = String(url);
        this.withCredentials = Boolean(init?.withCredentials);
      }

      close() {}
    }

    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: TestEventSource,
      writable: true,
    });
  });
}

test("authenticated user and staff complete the persisted support flow", async ({ page, browser }, testInfo) => {
  test.skip(
    missingEnvironment.length > 0,
    `Missing required support E2E environment: ${missingEnvironment.join(", ")}`,
  );

  const projectMarker = testInfo.project.name;
  const subject = `Account access [${projectMarker}]`;
  const openingBody = `I cannot sign in to my tournament account. [${projectMarker}]`;
  const replyBody = `Please reset your password and try again. [${projectMarker}]`;

  const adminContext = await browser.newContext({ baseURL: frontendUrl });
  await stubRealtimeBoundary(adminContext);
  const adminPage = await adminContext.newPage();

  try {
    await login(page.context(), requiredEnvironment.SUPPORT_E2E_USER_EMAIL!, requiredEnvironment.SUPPORT_E2E_USER_PASSWORD!, frontendUrl!);
    await login(adminContext, requiredEnvironment.E2E_ADMIN_EMAIL!, requiredEnvironment.E2E_ADMIN_PASSWORD!, frontendUrl!);

    await page.goto(`${frontendUrl}/support`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: /New conversation/ }).click();
    await expect(page.getByRole("heading", { name: "New conversation", exact: true })).toBeVisible();
    await page.getByLabel("Subject").fill(subject);
    await page.getByLabel("Message").fill(openingBody);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page).toHaveURL(/\/support\/[^/?#]+\?sent=1$/);
    const conversationId = new URL(page.url()).pathname.split("/").pop();
    expect(conversationId).toBeTruthy();

    const staffNotifications = await readJson(adminContext.request, "/api/v1/notifications?limit=30", frontendUrl!);
    expect(staffNotifications.data.items.find((item) => item.type === "support_message" && item.actionUrl === `/admin/support?conversationId=${conversationId}`)?.actionUrl)
      .toBe(`/admin/support?conversationId=${conversationId}`);

    const queueBeforeRead = await readJson(adminContext.request, "/api/v1/admin/support/conversations", frontendUrl!);
    const queuedConversation = queueBeforeRead.data.items.find((item) => item.id === conversationId);
    expect(queuedConversation?.subject).toBe(subject);
    expect(queuedConversation?.subject).toContain(projectMarker);
    expect(queuedConversation?.unreadCount).toBe(1);

    await adminPage.goto(`${frontendUrl}/admin/support?conversationId=${conversationId}`, { waitUntil: "domcontentloaded" });
    await expect(adminPage.getByRole("heading", { level: 2, name: subject })).toBeVisible();
    await expect.poll(async () => {
      const queue = await readJson(adminContext.request, "/api/v1/admin/support/conversations", frontendUrl!);
      return queue.data.items.find((item) => item.id === conversationId)?.unreadCount;
    }).toBe(0);

    await adminPage.getByLabel(/Reply to/).fill(replyBody);
    await adminPage.getByRole("button", { name: "Send reply" }).click();
    await expect(adminPage.getByText(replyBody).last()).toBeVisible();

    const userNotifications = await readJson(page.context().request, "/api/v1/notifications?limit=30", frontendUrl!);
    expect(userNotifications.data.items.find((item) => item.type === "support_message" && item.actionUrl === `/support/${conversationId}`)?.actionUrl)
      .toBe(`/support/${conversationId}`);

    await adminPage.getByRole("button", { name: "Resolve" }).click();
    await expect(adminPage.locator("span").filter({ hasText: /^Resolved$/ }).last()).toBeVisible();

    const userUnreadBeforeOpen = await readJson(page.context().request, "/api/v1/support/conversations", frontendUrl!);
    expect(userUnreadBeforeOpen.data.items.find((item) => item.id === conversationId)?.unreadCount).toBe(1);

    await page.goto(`${frontendUrl}/support/${conversationId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(replyBody).last()).toBeVisible();
    await expect(page.getByRole("button", { name: "Reopen conversation" })).toBeVisible();
    await page.getByRole("button", { name: "Reopen conversation" }).click();
    await expect(page.getByRole("button", { name: "Mark resolved" })).toBeVisible();
  } finally {
    await adminContext.close();
  }
});
