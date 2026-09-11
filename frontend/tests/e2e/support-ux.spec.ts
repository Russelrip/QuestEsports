import { expect, test, type Page } from "./test-fixture";

const user = { id: "support-user", firstName: "Quest", lastName: "Player", username: "questplayer", email: "player@example.com", emailVerified: true, role: "user", discordId: null };
const timestamp = "2026-09-10T04:00:00.000Z";

async function supportApi(page: Page) {
  let unread = 1;
  let failFirst = true;
  let status = "PENDING_USER";
  let subject = "Registration issue";
  const messages = [{ id: "reply-1", conversationId: "thread-1", senderUserId: "staff-1", body: "Please confirm your team name.", createdAt: timestamp, sender: null }];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const thread = () => ({ id: "thread-1", ownerUserId: user.id, subject, status, assignedStaffUserId: null, createdAt: timestamp, updatedAt: timestamp, resolvedAt: null, owner: null, assignedStaff: null, messages, unreadCount: unread });
    const respond = (data: unknown) => route.fulfill({ json: { success: true, data, meta: { serverNow: timestamp } } });
    if (path === "/api/me") return route.fulfill({ json: { success: true, user } });
    if (path === "/api/v1/support/unread") return respond({ unreadConversations: unread });
    if (path === "/api/v1/notifications") return respond({ items: [{ id: "alert-1", type: "support_message", title: "Quest Support replied", body: "Private message content must not appear in the feed", actionUrl: "/support/thread-1", createdAt: timestamp, readAt: unread ? null : timestamp }], unreadCount: unread, push: { enabled: false, publicKey: null }, preference: {} });
    if (path.startsWith("/api/v1/notifications/")) return respond({});
    if (path === "/api/v1/support/conversations" && method === "POST") {
      if (failFirst) { failFirst = false; return route.fulfill({ status: 503, json: { success: false, message: "Support is temporarily unavailable." } }); }
      const body = route.request().postDataJSON();
      subject = body.subject; status = "OPEN";
      messages.push({ id: "opening-1", conversationId: "thread-1", senderUserId: user.id, body: body.body, createdAt: timestamp, sender: null });
      return respond(thread());
    }
    if (path === "/api/v1/support/conversations") return respond({ items: [{ ...thread(), lastMessage: messages.at(-1), preview: messages.at(-1)?.body }], nextCursor: null });
    if (path.endsWith("/read")) { expect(route.request().postDataJSON().throughMessageId).toBeTruthy(); unread = 0; return respond({ lastReadAt: timestamp, unreadCount: 0 }); }
    if (path.endsWith("/resolve")) { status = "RESOLVED"; return respond(thread()); }
    if (path.endsWith("/reopen")) { status = "OPEN"; return respond(thread()); }
    if (path === "/api/v1/support/conversations/thread-1") return respond(thread());
    return route.fulfill({ json: { success: true, data: {}, meta: { serverNow: timestamp } } });
  });
}

test("support remains accessible without Discord and preserves drafts through the mobile/desktop journey", async ({ page }, testInfo) => {
  await supportApi(page);
  await page.goto("/support");
  await expect(page.getByRole("heading", { name: "Support inbox", exact: true })).toBeVisible();
  await expect(page.getByText("New reply", { exact: true })).toBeVisible();
  const mobile = (page.viewportSize()?.width || 1280) < 1024;
  if (mobile) await page.getByRole("button", { name: "Open navigation" }).click();
  else await page.getByRole("button", { name: /questplayer/ }).click();
  const inboxLink = page.getByRole("link", { name: /Support inbox.*1 conversations/ });
  await expect(inboxLink).toBeVisible();
  await inboxLink.click();
  await page.getByRole("link", { name: /New conversation/ }).click();
  await expect(page).toHaveURL(/\/support\/new$/);
  if (mobile) await expect(page.getByRole("complementary", { name: "Support conversations" })).toBeHidden();
  await page.getByLabel("Subject").fill("Payment question");
  await page.getByLabel("Message").fill("My payment needs checking.");
  await page.getByRole("link", { name: /Back to support inbox/ }).click();
  await page.getByRole("link", { name: /New conversation/ }).click();
  await expect(page.getByLabel("Message")).toHaveValue("My payment needs checking.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Your text is still here" })).toBeVisible();
  await expect(page.getByLabel("Message")).toHaveValue("My payment needs checking.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page).toHaveURL(/\/support\/thread-1\?sent=1$/);
  await expect(page.getByText("Message sent.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payment question", level: 2 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Conversation", exact: true }).getByText("My payment needs checking.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByRole("textbox", { name: /Reply/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Reopen conversation" }).click();
  await expect(page.getByRole("textbox", { name: /Reply/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("support-thread.png"), fullPage: true });
  await page.getByRole("link", { name: /Back to support inbox/ }).click();
  await expect(page).toHaveURL(/\/support$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/support\/thread-1\?sent=1$/);
  await expect(page.getByRole("heading", { name: "Payment question", level: 2 })).toBeVisible();
});

test("support notifications and Contact choices have distinct destinations", async ({ page }, testInfo) => {
  await supportApi(page);
  await page.goto("/contact");
  await expect(page.getByRole("heading", { name: "How can we help?" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open support inbox/ })).toHaveAttribute("href", "/support");
  await page.getByRole("link", { name: /General enquiries/ }).click();
  await expect(page.getByRole("textbox", { name: /Email/ })).toBeVisible();
  if ((page.viewportSize()?.width || 1280) < 1024) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "1 unread notifications" }).click();
  const group = page.getByRole("region", { name: "Support notifications" });
  await expect(group.getByRole("link", { name: /Quest Support replied/ })).toHaveAttribute("href", "/support/thread-1");
  await expect(page.getByText("Private message content must not appear in the feed")).toHaveCount(0);
  await group.getByRole("link", { name: /Quest Support replied/ }).click();
  await expect(page.getByRole("heading", { name: "Registration issue", level: 2 })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("support-reply.png"), fullPage: true });
});
