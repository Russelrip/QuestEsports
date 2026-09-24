import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotificationBell from "../../components/notifications/NotificationBell";

const mocks = vi.hoisted(() => ({
  apiFetchJson: vi.fn(),
  subscribeToRealtimeUpdates: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ apiFetchJson: mocks.apiFetchJson }));
vi.mock("@/lib/realtime", () => ({ subscribeToRealtimeUpdates: mocks.subscribeToRealtimeUpdates }));
vi.mock("@/components/support/SupportProvider", () => ({ notifySupportRead: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a>,
}));

const user = {
  id: "user-1",
  firstName: "Player",
  lastName: "One",
  email: "player@example.com",
  username: "player",
  role: "user" as const,
  emailVerified: true,
};

const notificationResponse = ({ actionUrl, type = "match", title = "Notification", body = "Open now" }: { actionUrl: unknown; type?: string; title?: string; body?: string }) => ({
  response: new Response(null, { status: 200 }),
  data: {
    success: true,
    data: {
      items: [{
        id: "notification-1",
        type,
        title,
        body,
        actionUrl,
        readAt: null,
        createdAt: "2026-08-19T12:00:00.000Z",
      }],
      unreadCount: 1,
      push: { enabled: false, publicKey: null },
      preference: { matchPushEnabled: true, soundEnabled: true, matchEmailEnabled: false },
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.subscribeToRealtimeUpdates.mockReturnValue(vi.fn());
  mocks.apiFetchJson.mockResolvedValue(notificationResponse({ actionUrl: "https://attacker.example/steal" }));
});

afterEach(() => {
  cleanup();
});

describe("notification navigation", () => {
  it("falls back to the profile for an external action URL", async () => {
    mocks.apiFetchJson.mockResolvedValue(notificationResponse({
      actionUrl: "https://attacker.example/steal",
      title: "Match ready",
      body: "Join now",
    }));
    const interaction = userEvent.setup();
    render(<NotificationBell user={user} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "1 unread notifications" })).toBeInTheDocument());
    await interaction.click(screen.getByRole("button", { name: "1 unread notifications" }));

    expect(screen.getByRole("link", { name: /Match ready/ })).toHaveAttribute("href", "/profile");
  });

  it("falls back safely for a malformed support action URL", async () => {
    mocks.apiFetchJson.mockResolvedValue(notificationResponse({
      type: "support_message",
      actionUrl: { startsWith: () => { throw new Error("must not be called"); } },
    }));
    const interaction = userEvent.setup();
    render(<NotificationBell user={user} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "1 unread notifications" })).toBeInTheDocument());
    await interaction.click(screen.getByRole("button", { name: "1 unread notifications" }));

    expect(screen.getByRole("link", { name: /Notification/ })).toHaveAttribute("href", "/profile");
  });

  it("preserves valid admin support destinations", async () => {
    mocks.apiFetchJson.mockResolvedValue(notificationResponse({
      type: "support_message",
      actionUrl: "/admin/support?conversationId=conversation-1",
    }));
    const interaction = userEvent.setup();
    render(<NotificationBell user={user} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "1 unread notifications" })).toBeInTheDocument());
    await interaction.click(screen.getByRole("button", { name: "1 unread notifications" }));

    expect(screen.getByRole("link", { name: /Notification/ })).toHaveAttribute(
      "href",
      "/admin/support?conversationId=conversation-1",
    );
  });

  it("preserves valid user support destinations", async () => {
    mocks.apiFetchJson.mockResolvedValue(notificationResponse({
      type: "support_message",
      actionUrl: "/support/conversation-1",
    }));
    const interaction = userEvent.setup();
    render(<NotificationBell user={user} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "1 unread notifications" })).toBeInTheDocument());
    await interaction.click(screen.getByRole("button", { name: "1 unread notifications" }));

    expect(screen.getByRole("link", { name: /Notification/ })).toHaveAttribute(
      "href",
      "/support/conversation-1",
    );
  });
});
