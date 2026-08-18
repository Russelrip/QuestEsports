import { expect, openPage, test, type Page, type Route } from "./test-fixture";

type Role = "user" | "admin";
type SupportMessage = {
  id: string;
  conversationId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
  sender: { id: string; username: string; firstName: string; lastName: string; avatarUrl: null };
};

const users = {
  user: {
    id: "support-user",
    firstName: "Asha",
    lastName: "Player",
    email: "asha@example.com",
    username: "asha",
    role: "user" as const,
    emailVerified: true,
  },
  admin: {
    id: "support-admin",
    firstName: "Quest",
    lastName: "Staff",
    email: "staff@example.com",
    username: "queststaff",
    role: "admin" as const,
    emailVerified: true,
  },
};

const supportUser = (user: (typeof users)[Role]) => ({
  id: user.id,
  username: user.username,
  firstName: user.firstName,
  lastName: user.lastName,
  avatarUrl: null,
});

async function installSupportSessionFixture(page: Page) {
  let role: Role = "user";
  const state: {
    conversation: {
      id: string;
      ownerUserId: string;
      subject: string;
      status: "OPEN" | "PENDING_USER" | "PENDING_STAFF" | "RESOLVED";
      assignedStaffUserId: string | null;
      createdAt: string;
      updatedAt: string;
      resolvedAt: string | null;
      messages: SupportMessage[];
    } | null;
    adminReadRequests: number;
    adminListUnreadCounts: number[];
  } = {
    conversation: null,
    adminReadRequests: 0,
    adminListUnreadCounts: [],
  };

  const respond = (route: Route, data: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data, meta: { serverNow: "2026-08-19T12:00:00.000Z" } }),
    });

  const unreadCount = (viewerId: string) => state.conversation?.messages.filter((message) =>
    message.senderUserId !== viewerId && (viewerId === users.admin.id ? state.adminReadRequests === 0 : !state.conversation?.resolvedAt)
  ).length || 0;

  const summary = (viewerId: string) => {
    if (!state.conversation) return null;
    const lastMessage = state.conversation.messages.at(-1) || null;
    return {
      ...state.conversation,
      owner: supportUser(users.user),
      assignedStaff: null,
      lastMessage,
      preview: lastMessage?.body || null,
      unreadCount: unreadCount(viewerId),
    };
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const viewer = users[role];
    const body = (() => {
      try {
        return request.postDataJSON() as Record<string, string>;
      } catch {
        return {};
      }
    })();

    if (path === "/api/me" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, user: viewer }),
      });
      return;
    }

    if (path === "/api/v1/admin/support/conversations" && request.method() === "GET") {
      const item = summary(users.admin.id);
      if (item) state.adminListUnreadCounts.push(item.unreadCount);
      await respond(route, { items: item ? [item] : [], nextCursor: null });
      return;
    }

    if (path === "/api/v1/support/conversations" && request.method() === "GET") {
      const item = role === "user" ? summary(users.user.id) : summary(users.admin.id);
      if (role === "admin" && item) state.adminListUnreadCounts.push(item.unreadCount);
      await respond(route, { items: item ? [item] : [], nextCursor: null });
      return;
    }

    if (path === "/api/v1/support/conversations" && request.method() === "POST") {
      const createdAt = "2026-08-19T12:01:00.000Z";
      const conversationId = "support-conversation-1";
      const message: SupportMessage = {
        id: "support-message-1",
        conversationId,
        senderUserId: users.user.id,
        body: body.body,
        createdAt,
        sender: supportUser(users.user),
      };
      state.conversation = {
        id: conversationId,
        ownerUserId: users.user.id,
        subject: body.subject,
        status: "OPEN",
        assignedStaffUserId: null,
        createdAt,
        updatedAt: createdAt,
        resolvedAt: null,
        messages: [message],
      };
      await respond(route, { ...state.conversation, owner: supportUser(users.user), assignedStaff: null, unreadCount: 0 }, 201);
      return;
    }

    const conversationMatch = path.match(/\/api\/v1\/(admin\/support\/|support\/)conversations\/([^/]+)(?:\/(read|messages|status|reopen|resolve))?$/);
    if (conversationMatch && state.conversation?.id === conversationMatch[2]) {
      const isAdmin = conversationMatch[1] === "admin/support/";
      const action = conversationMatch[3];
      if (isAdmin && role !== "admin") {
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, message: "Forbidden" }) });
        return;
      }
      if (!isAdmin && role !== "user") {
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ success: false, message: "Forbidden" }) });
        return;
      }
      if (!action && request.method() === "GET") {
        await respond(route, { ...state.conversation, owner: supportUser(users.user), assignedStaff: null, unreadCount: unreadCount(viewer.id) });
        return;
      }
      if (action === "read" && request.method() === "PATCH") {
        if (isAdmin) state.adminReadRequests += 1;
        await respond(route, { lastReadAt: "2026-08-19T12:05:00.000Z", unreadCount: 0 });
        return;
      }
      if (action === "messages" && request.method() === "POST") {
        const createdAt = "2026-08-19T12:06:00.000Z";
        const message: SupportMessage = {
          id: "support-message-2",
          conversationId: state.conversation.id,
          senderUserId: viewer.id,
          body: body.body,
          createdAt,
          sender: supportUser(viewer),
        };
        state.conversation.messages.push(message);
        state.conversation.status = isAdmin ? "PENDING_USER" : "PENDING_STAFF";
        state.conversation.updatedAt = createdAt;
        state.conversation.resolvedAt = null;
        await respond(route, { message, status: state.conversation.status }, 201);
        return;
      }
      if ((action === "status" && request.method() === "PATCH") || ((action === "reopen" || action === "resolve") && request.method() === "POST")) {
        state.conversation.status = action === "reopen" || body.status === "OPEN" ? "OPEN" : "RESOLVED";
        state.conversation.resolvedAt = state.conversation.status === "RESOLVED" ? "2026-08-19T12:07:00.000Z" : null;
        state.conversation.updatedAt = "2026-08-19T12:07:00.000Z";
        await respond(route, { ...state.conversation, owner: supportUser(users.user), assignedStaff: null, unreadCount: unreadCount(viewer.id) });
        return;
      }
    }

    await route.fallback();
  });

  return {
    asAdmin() { role = "admin"; },
    asUser() { role = "user"; },
    state,
  };
}

test("authenticated user and staff can complete a support conversation", async ({ page }) => {
  const fixture = await installSupportSessionFixture(page);

  await openPage(page, "/support");
  await expect(page.getByRole("heading", { name: "Start a support conversation" })).toBeVisible();
  await page.getByLabel("Subject").fill("Account access");
  await page.getByLabel("Message").fill("I cannot sign in to my tournament account.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Account access" })).toBeVisible();
  await expect(page.getByText("I cannot sign in to my tournament account.").last()).toBeVisible();

  fixture.asAdmin();
  await openPage(page, "/admin/support");
  await expect(page.getByRole("heading", { name: "Support queue" })).toBeVisible();
  await expect.poll(() => fixture.state.adminListUnreadCounts.at(-1)).toBe(1);
  await page.getByRole("button", { name: /Account access/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Account access" })).toBeVisible();
  await expect.poll(() => fixture.state.adminReadRequests).toBe(1);
  await expect.poll(() => fixture.state.adminListUnreadCounts.at(-1)).toBe(0);

  await page.getByLabel("Reply to Asha Player").fill("Please reset your password and try again.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Please reset your password and try again.").last()).toBeVisible();
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.locator("span").filter({ hasText: /^Resolved$/ }).last()).toBeVisible();

  fixture.asUser();
  await openPage(page, "/support/support-conversation-1");
  await expect(page.getByText("Please reset your password and try again.").last()).toBeVisible();
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.getByRole("button", { name: "Resolve" })).toBeVisible();
});
