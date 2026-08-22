import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SupportComposer from "../../components/support/SupportComposer";
import SupportConversationList from "../../components/support/SupportConversationList";
import SupportInbox from "../../components/support/SupportInbox";
import SupportThread from "../../components/support/SupportThread";
import NotificationBell from "../../components/notifications/NotificationBell";
import type { SupportConversation, SupportConversationSummary } from "../../lib/support";

const mocks = vi.hoisted(() => ({ apiFetchJson: vi.fn(), listSupportConversations: vi.fn(), getSupportConversation: vi.fn(), markSupportConversationRead: vi.fn(), createSupportConversation: vi.fn(), sendSupportMessage: vi.fn(), reopenSupportConversation: vi.fn(), resolveSupportConversation: vi.fn(), showToast: vi.fn(), auth: { user: { id: "user-1" }, isLoading: false } }));
const { apiFetchJson, listSupportConversations, getSupportConversation, markSupportConversationRead, createSupportConversation, sendSupportMessage, reopenSupportConversation } = mocks;

vi.mock("@/lib/auth", () => ({ apiFetchJson: mocks.apiFetchJson, apiFetch: vi.fn() }));
vi.mock("@/lib/support", () => ({ listSupportConversations: mocks.listSupportConversations, getSupportConversation: mocks.getSupportConversation, markSupportConversationRead: mocks.markSupportConversationRead, createSupportConversation: mocks.createSupportConversation, sendSupportMessage: mocks.sendSupportMessage, reopenSupportConversation: mocks.reopenSupportConversation, resolveSupportConversation: mocks.resolveSupportConversation }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/useToastStore", () => ({ useToastStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) => selector({ showToast: mocks.showToast }) }));
vi.mock("@/lib/realtime", () => ({ subscribeToRealtimeUpdates: () => () => undefined }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a> }));

const message = (id: string, senderUserId = "user-1", body = "I need help", conversationId = "conversation-1") => ({ id, conversationId, senderUserId, body, createdAt: "2026-08-19T12:00:00.000Z", sender: { id: senderUserId, username: "player", firstName: senderUserId === "user-1" ? "Player" : "Staff", lastName: null, avatarUrl: null } });
const conversation = (status: SupportConversation["status"] = "OPEN", id = "conversation-1", subject = "Registration help"): SupportConversation => ({ id, ownerUserId: "user-1", subject, status, assignedStaffUserId: null, createdAt: "2026-08-19T11:00:00.000Z", updatedAt: "2026-08-19T12:00:00.000Z", resolvedAt: status === "RESOLVED" ? "2026-08-19T12:30:00.000Z" : null, owner: null, assignedStaff: null, unreadCount: 0, messages: [message("message-1", "user-1", "I need help", id)] });

beforeEach(() => { vi.clearAllMocks(); mocks.auth.user = { id: "user-1" }; listSupportConversations.mockResolvedValue({ items: [], nextCursor: null }); getSupportConversation.mockResolvedValue(conversation()); markSupportConversationRead.mockResolvedValue({ lastReadAt: "now", unreadCount: 0 }); });
afterEach(() => cleanup());

describe("support inbox rendered states", () => {
  it("shows a helpful empty state", async () => { render(<SupportInbox />); expect(await screen.findByText(/No conversations yet/)).toBeInTheDocument(); expect(screen.getByText("Start a support conversation")).toBeInTheDocument(); });

  it("renders unread counts and status labels", () => { render(<SupportConversationList selectedId="one" items={[{ ...conversation(), lastMessage: message("message-2", "staff-1", "We are checking this"), preview: "We are checking this", unreadCount: 2, status: "PENDING_USER" }]} />); expect(screen.getByText("Your reply")).toBeInTheDocument(); expect(screen.getByText("2")).toBeInTheDocument(); expect(screen.getByText("We are checking this")).toBeInTheDocument(); });

  it("associates empty-composer errors with the subject input", async () => { const user = userEvent.setup(); render(<SupportComposer onSubmit={vi.fn()} />); await user.click(screen.getByRole("button", { name: "Send message" })); expect(await screen.findByText("Subject is required.")).toBeInTheDocument(); expect(screen.getByLabelText(/Subject/)).toHaveAttribute("aria-invalid", "true"); expect(screen.getByLabelText(/Subject/)).toHaveAttribute("aria-describedby", "supportSubject-error"); });

  it("announces body validation and associates it with the message field", async () => { const user = userEvent.setup(); render(<SupportComposer onSubmit={vi.fn()} />); await user.type(screen.getByLabelText(/Subject/), "Account help"); await user.click(screen.getByRole("button", { name: "Send message" })); expect(await screen.findByText("Message is required.")).toBeInTheDocument(); expect(screen.getByLabelText(/Message/)).toHaveAttribute("aria-invalid", "true"); expect(screen.getByLabelText(/Message/)).toHaveAttribute("aria-describedby", "supportBody-error"); });

  it("shows a retryable create failure without losing the message", async () => { const user = userEvent.setup(); createSupportConversation.mockRejectedValue(new Error("Network unavailable")); render(<SupportInbox />); await screen.findByText("Start a support conversation"); const subject = screen.getByLabelText(/Subject/); const body = screen.getByLabelText(/Message/); await user.type(subject, "Login issue"); await user.type(body, "Please help me sign in."); await user.click(screen.getByRole("button", { name: "Send message" })); expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable"); expect(subject).toHaveValue("Login issue"); expect(body).toHaveValue("Please help me sign in."); await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).not.toBeDisabled()); });

  it("reopens a resolved thread and resets the reply input after success", async () => { const user = userEvent.setup(); const resolved = conversation("RESOLVED"); reopenSupportConversation.mockResolvedValue(conversation("OPEN")); sendSupportMessage.mockResolvedValue({ message: message("message-2"), status: "PENDING_STAFF" }); render(<SupportThread conversation={resolved} currentUserId="user-1" onChanged={vi.fn()} />); await user.click(screen.getByRole("button", { name: "Reopen" })); expect(await screen.findByText("Open")).toBeInTheDocument(); await user.type(screen.getByLabelText(/Message/), "Following up"); await user.click(screen.getAllByRole("button", { name: "Send message" }).at(-1)!); await waitFor(() => expect(screen.getByLabelText(/Message/)).toHaveValue("")); });

  it("shows a pending send state and disables the reply textarea", async () => { const user = userEvent.setup(); let resolveSend!: (value: { message: ReturnType<typeof message>; status: "PENDING_STAFF" }) => void; sendSupportMessage.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; })); render(<SupportThread conversation={conversation()} currentUserId="user-1" onChanged={vi.fn()} />); const body = screen.getByLabelText(/Message/); await user.type(body, "Still need help"); await user.click(screen.getByRole("button", { name: "Send message" })); expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled(); expect(body).toBeDisabled(); resolveSend({ message: message("message-2"), status: "PENDING_STAFF" }); await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled()); });

  it("shows a failed reply and retries the actual send", async () => { const user = userEvent.setup(); sendSupportMessage.mockRejectedValueOnce(new Error("Reply failed")).mockResolvedValueOnce({ message: message("message-2"), status: "PENDING_STAFF" }); render(<SupportThread conversation={conversation()} currentUserId="user-1" onChanged={vi.fn()} />); const body = screen.getByLabelText(/Message/); await user.type(body, "Please retry this"); await user.click(screen.getByRole("button", { name: "Send message" })); expect(await screen.findByRole("alert")).toHaveTextContent("Reply failed"); await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled()); await user.click(screen.getByRole("button", { name: "Send message" })); await waitFor(() => expect(body).toHaveValue("")); expect(sendSupportMessage).toHaveBeenCalledTimes(2); });

  it("offers thread retry and keeps list errors separate", async () => { const user = userEvent.setup(); getSupportConversation.mockRejectedValueOnce(new Error("Thread unavailable")); render(<SupportInbox conversationId="conversation-1" />); expect(await screen.findByRole("alert")).toHaveTextContent("Thread unavailable"); getSupportConversation.mockResolvedValueOnce(conversation()); await user.click(screen.getByRole("button", { name: "Try again" })); expect(await screen.findByText("Registration help")).toBeInTheDocument(); });

  it("refreshes summaries after marking a thread read", async () => { render(<SupportInbox conversationId="conversation-1" />); await waitFor(() => expect(markSupportConversationRead).toHaveBeenCalledWith("conversation-1")); await waitFor(() => expect(listSupportConversations).toHaveBeenCalledTimes(2)); });

  it("shows mark-read failures inside the loaded thread", async () => { markSupportConversationRead.mockRejectedValueOnce(new Error("Read status failed")); render(<SupportInbox conversationId="conversation-1" />); expect(await screen.findByRole("alert")).toHaveTextContent("Read status failed"); expect(screen.getByText("Registration help")).toBeInTheDocument(); });

  it("polls the inbox and selected thread, then stops after unmount", async () => {
    vi.useFakeTimers();
    try {
      const view = render(<SupportInbox conversationId="conversation-1" />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      vi.clearAllMocks();

      await act(async () => {
        vi.advanceTimersByTime(30_000);
        await Promise.resolve();
      });
      expect(listSupportConversations).toHaveBeenCalled();
      expect(getSupportConversation).toHaveBeenCalledWith("conversation-1");

      vi.clearAllMocks();
      view.unmount();
      await act(async () => {
        vi.advanceTimersByTime(30_000);
        await Promise.resolve();
      });
      expect(listSupportConversations).not.toHaveBeenCalled();
      expect(getSupportConversation).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a pending list response current when the selected conversation changes", async () => {
    let resolveList!: (value: { items: SupportConversationSummary[]; nextCursor: null }) => void;
    const pendingList = new Promise<{ items: SupportConversationSummary[]; nextCursor: null }>((resolve) => { resolveList = resolve; });
    const currentItem = { ...conversation("OPEN", "conversation-2", "Current conversation"), lastMessage: null, preview: null };
    listSupportConversations.mockReset();
    listSupportConversations.mockImplementationOnce(() => pendingList);

    const view = render(<SupportInbox conversationId="conversation-1" />);
    await waitFor(() => expect(listSupportConversations).toHaveBeenCalledTimes(1));
    view.rerender(<SupportInbox conversationId="conversation-2" />);
    expect(listSupportConversations).toHaveBeenCalledTimes(1);
    resolveList({ items: [currentItem], nextCursor: null });

    expect(await screen.findByText("Current conversation")).toBeInTheDocument();
    expect(screen.queryByText("Loading your conversations…")).not.toBeInTheDocument();
  });

  it("ignores a stale thread response after the selected conversation changes", async () => {
    let resolveFirst!: (value: SupportConversation) => void;
    const firstResponse = new Promise<SupportConversation>((resolve) => { resolveFirst = resolve; });
    const nextConversation = conversation("OPEN", "conversation-2", "New conversation");
    getSupportConversation.mockReset();
    getSupportConversation.mockImplementationOnce(() => firstResponse).mockResolvedValueOnce(nextConversation);

    const view = render(<SupportInbox conversationId="conversation-1" />);
    await waitFor(() => expect(getSupportConversation).toHaveBeenCalledWith("conversation-1"));
    view.rerender(<SupportInbox conversationId="conversation-2" />);
    await waitFor(() => expect(getSupportConversation).toHaveBeenCalledWith("conversation-2"));
    expect(await screen.findByText("New conversation")).toBeInTheDocument();

    resolveFirst(conversation("OPEN", "conversation-1", "Stale conversation"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText("New conversation")).toBeInTheDocument();
    expect(screen.queryByText("Stale conversation")).not.toBeInTheDocument();
  });

  it("ignores a stale list response after the authenticated user changes", async () => {
    let resolveFirst!: (value: { items: SupportConversationSummary[]; nextCursor: null }) => void;
    const firstResponse = new Promise<{ items: SupportConversationSummary[]; nextCursor: null }>((resolve) => { resolveFirst = resolve; });
    const nextItems = [{ ...conversation("OPEN", "conversation-2", "User two conversation"), lastMessage: null, preview: null }];
    listSupportConversations.mockReset();
    listSupportConversations.mockImplementationOnce(() => firstResponse).mockResolvedValueOnce({ items: nextItems, nextCursor: null });

    const view = render(<SupportInbox />);
    await waitFor(() => expect(listSupportConversations).toHaveBeenCalledTimes(1));
    mocks.auth.user = { id: "user-2" };
    view.rerender(<SupportInbox />);
    await waitFor(() => expect(listSupportConversations).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("User two conversation")).toBeInTheDocument();

    resolveFirst({ items: [{ ...conversation("OPEN", "conversation-1", "Stale user conversation"), lastMessage: null, preview: null }], nextCursor: null });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText("User two conversation")).toBeInTheDocument();
    expect(screen.queryByText("Stale user conversation")).not.toBeInTheDocument();
    mocks.auth.user = { id: "user-1" };
  });
});

describe("support notifications", () => {
  it("navigates support notifications to the conversation thread", async () => { const user = userEvent.setup(); apiFetchJson.mockResolvedValue({ response: new Response(null, { status: 200 }), data: { success: true, data: { items: [{ id: "notification-1", type: "support_message", title: "New support message", body: "A reply is waiting", actionUrl: "/support/conversation-1", readAt: null, createdAt: "2026-08-19T12:00:00.000Z" }], unreadCount: 1, push: { enabled: false, publicKey: null }, preference: { matchPushEnabled: true, soundEnabled: true, matchEmailEnabled: false } } } }); render(<NotificationBell user={{ id: "user-1", firstName: "Player", lastName: "One", email: "player@example.com", username: "player", role: "user", emailVerified: true }} />); await waitFor(() => expect(screen.getByRole("button", { name: "1 unread notifications" })).toBeInTheDocument()); await user.click(screen.getByRole("button", { name: "1 unread notifications" })); expect(screen.getByRole("link", { name: /New support message/ })).toHaveAttribute("href", "/support/conversation-1"); });
  it("navigates staff support notifications to the admin conversation query", async () => { const user = userEvent.setup(); apiFetchJson.mockResolvedValue({ response: new Response(null, { status: 200 }), data: { success: true, data: { items: [{ id: "notification-2", type: "support_message", title: "New support message", body: "A player is waiting", actionUrl: "/admin/support?conversationId=conversation-1", readAt: null, createdAt: "2026-08-19T12:00:00.000Z" }], unreadCount: 1, push: { enabled: false, publicKey: null }, preference: { matchPushEnabled: true, soundEnabled: true, matchEmailEnabled: false } } } }); render(<NotificationBell user={{ id: "staff-1", firstName: "Quest", lastName: "Staff", email: "staff@example.com", username: "staff", role: "admin", emailVerified: true }} />); await waitFor(() => expect(screen.getByRole("button", { name: "1 unread notifications" })).toBeInTheDocument()); await user.click(screen.getByRole("button", { name: "1 unread notifications" })); expect(screen.getByRole("link", { name: /New support message/ })).toHaveAttribute("href", "/admin/support?conversationId=conversation-1"); });
});
