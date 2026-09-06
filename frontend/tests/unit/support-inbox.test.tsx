import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SupportComposer from "../../components/support/SupportComposer";
import SupportConversationList from "../../components/support/SupportConversationList";
import SupportInbox from "../../components/support/SupportInbox";
import SupportThread from "../../components/support/SupportThread";
import NotificationBell from "../../components/notifications/NotificationBell";
import type { SupportConversation, SupportConversationSummary } from "../../lib/support";

const mocks = vi.hoisted(() => ({ apiFetchJson: vi.fn(), listSupportConversations: vi.fn(), getSupportConversation: vi.fn(), markSupportConversationRead: vi.fn(), createSupportConversation: vi.fn(), sendSupportMessage: vi.fn(), reopenSupportConversation: vi.fn(), resolveSupportConversation: vi.fn(), subscribeToRealtimeUpdates: vi.fn(), showToast: vi.fn(), auth: { user: { id: "user-1" }, isLoading: false } }));
const { apiFetchJson, listSupportConversations, getSupportConversation, markSupportConversationRead, createSupportConversation, sendSupportMessage, reopenSupportConversation, subscribeToRealtimeUpdates } = mocks;

vi.mock("@/lib/auth", () => ({ apiFetchJson: mocks.apiFetchJson, apiFetch: vi.fn() }));
vi.mock("@/lib/support", () => ({ listSupportConversations: mocks.listSupportConversations, getSupportConversation: mocks.getSupportConversation, markSupportConversationRead: mocks.markSupportConversationRead, createSupportConversation: mocks.createSupportConversation, sendSupportMessage: mocks.sendSupportMessage, reopenSupportConversation: mocks.reopenSupportConversation, resolveSupportConversation: mocks.resolveSupportConversation }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/useToastStore", () => ({ useToastStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) => selector({ showToast: mocks.showToast }) }));
vi.mock("@/lib/realtime", () => ({ subscribeToRealtimeUpdates: mocks.subscribeToRealtimeUpdates }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a> }));

const message = (id: string, senderUserId = "user-1", body = "I need help", conversationId = "conversation-1") => ({ id, conversationId, senderUserId, body, createdAt: "2026-08-19T12:00:00.000Z", sender: { id: senderUserId, username: "player", firstName: senderUserId === "user-1" ? "Player" : "Staff", lastName: null, avatarUrl: null } });
const conversation = (status: SupportConversation["status"] = "OPEN", id = "conversation-1", subject = "Registration help"): SupportConversation => ({ id, ownerUserId: "user-1", subject, status, assignedStaffUserId: null, createdAt: "2026-08-19T11:00:00.000Z", updatedAt: "2026-08-19T12:00:00.000Z", resolvedAt: status === "RESOLVED" ? "2026-08-19T12:30:00.000Z" : null, owner: null, assignedStaff: null, unreadCount: 0, messages: [message("message-1", "user-1", "I need help", id)] });

beforeEach(() => { vi.clearAllMocks(); mocks.auth.user = { id: "user-1" }; subscribeToRealtimeUpdates.mockReturnValue(vi.fn()); listSupportConversations.mockResolvedValue({ items: [], nextCursor: null }); getSupportConversation.mockResolvedValue(conversation()); markSupportConversationRead.mockResolvedValue({ lastReadAt: "now", unreadCount: 0 }); });
afterEach(() => cleanup());

describe("support inbox rendered states", () => {
  it("shows a helpful empty state", async () => { render(<SupportInbox />); expect(await screen.findByText(/No conversations yet/)).toBeInTheDocument(); expect(screen.getByText("Start a support conversation")).toBeInTheDocument(); });

  it("renders unread counts and status labels", () => { render(<SupportConversationList selectedId="one" items={[{ ...conversation(), lastMessage: message("message-2", "staff-1", "We are checking this"), preview: "We are checking this", unreadCount: 2, status: "PENDING_USER" }]} />); expect(screen.getByText("Your reply")).toBeInTheDocument(); expect(screen.getByText("2")).toBeInTheDocument(); expect(screen.getByText("We are checking this")).toBeInTheDocument(); });

  it("associates empty-composer errors with the subject input", async () => { const user = userEvent.setup(); render(<SupportComposer onSubmit={vi.fn()} />); await user.click(screen.getByRole("button", { name: "Send message" })); expect(await screen.findByText("Subject is required.")).toBeInTheDocument(); expect(screen.getByLabelText(/Subject/)).toHaveAttribute("aria-invalid", "true"); expect(screen.getByLabelText(/Subject/)).toHaveAttribute("aria-describedby", "supportSubject-error"); });

  it("announces body validation and associates it with the message field", async () => { const user = userEvent.setup(); render(<SupportComposer onSubmit={vi.fn()} />); await user.type(screen.getByLabelText(/Subject/), "Account help"); await user.click(screen.getByRole("button", { name: "Send message" })); expect(await screen.findByText("Message is required.")).toBeInTheDocument(); expect(screen.getByLabelText(/Message/)).toHaveAttribute("aria-invalid", "true"); expect(screen.getByLabelText(/Message/)).toHaveAttribute("aria-describedby", "supportBody-error"); });

  it("shows a retryable create failure without losing the message", async () => { const user = userEvent.setup(); createSupportConversation.mockRejectedValue(new Error("Network unavailable")); render(<SupportInbox />); await screen.findByText("Start a support conversation"); const subject = screen.getByLabelText(/Subject/); const body = screen.getByLabelText(/Message/); await user.type(subject, "Login issue"); await user.type(body, "Please help me sign in."); await user.click(screen.getByRole("button", { name: "Send message" })); expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable"); expect(subject).toHaveValue("Login issue"); expect(body).toHaveValue("Please help me sign in."); await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).not.toBeDisabled()); });

  it("ignores a deferred create completion after the authenticated user changes", async () => {
    const user = userEvent.setup();
    let resolveCreate!: (value: SupportConversation) => void;
    const pendingCreate = new Promise<SupportConversation>((resolve) => { resolveCreate = resolve; });
    const pushState = vi.spyOn(window.history, "pushState");
    createSupportConversation.mockReturnValue(pendingCreate);

    const view = render(<SupportInbox />);
    await screen.findByText("Start a support conversation");
    await user.type(screen.getByLabelText(/Subject/), "Login issue");
    await user.type(screen.getByLabelText(/Message/), "Please help me sign in.");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(createSupportConversation).toHaveBeenCalledWith("Login issue", "Please help me sign in."));

    mocks.auth.user = { id: "user-2" };
    view.rerender(<SupportInbox />);
    await waitFor(() => expect(listSupportConversations).toHaveBeenCalledTimes(2));

    resolveCreate(conversation("OPEN", "stale-conversation", "Stale conversation"));
    await act(async () => { await pendingCreate; await Promise.resolve(); });

    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
    expect(screen.queryByText("Stale conversation")).not.toBeInTheDocument();
    pushState.mockRestore();
    mocks.auth.user = { id: "user-1" };
  });

  it("reopens a resolved thread and resets the reply input after success", async () => { const user = userEvent.setup(); const resolved = conversation("RESOLVED"); reopenSupportConversation.mockResolvedValue(conversation("OPEN")); sendSupportMessage.mockResolvedValue({ message: message("message-2"), status: "PENDING_STAFF" }); render(<SupportThread conversation={resolved} currentUserId="user-1" onChanged={vi.fn()} />); await user.click(screen.getByRole("button", { name: "Reopen" })); expect(await screen.findByText("Open")).toBeInTheDocument(); await user.type(screen.getByLabelText(/Message/), "Following up"); await user.click(screen.getAllByRole("button", { name: "Send message" }).at(-1)!); await waitFor(() => expect(screen.getByLabelText(/Message/)).toHaveValue("")); });

  it("shows a pending send state and disables the reply textarea", async () => { const user = userEvent.setup(); let resolveSend!: (value: { message: ReturnType<typeof message>; status: "PENDING_STAFF" }) => void; sendSupportMessage.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; })); render(<SupportThread conversation={conversation()} currentUserId="user-1" onChanged={vi.fn()} />); const body = screen.getByLabelText(/Message/); await user.type(body, "Still need help"); await user.click(screen.getByRole("button", { name: "Send message" })); expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled(); expect(body).toBeDisabled(); resolveSend({ message: message("message-2"), status: "PENDING_STAFF" }); await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled()); });

  it("shows a failed reply and retries the actual send", async () => { const user = userEvent.setup(); sendSupportMessage.mockRejectedValueOnce(new Error("Reply failed")).mockResolvedValueOnce({ message: message("message-2"), status: "PENDING_STAFF" }); render(<SupportThread conversation={conversation()} currentUserId="user-1" onChanged={vi.fn()} />); const body = screen.getByLabelText(/Message/); await user.type(body, "Please retry this"); await user.click(screen.getByRole("button", { name: "Send message" })); expect(await screen.findByRole("alert")).toHaveTextContent("Reply failed"); await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled()); await user.click(screen.getByRole("button", { name: "Send message" })); await waitFor(() => expect(body).toHaveValue("")); expect(sendSupportMessage).toHaveBeenCalledTimes(2); });

  it("offers thread retry and keeps list errors separate", async () => { const user = userEvent.setup(); getSupportConversation.mockRejectedValueOnce(new Error("Thread unavailable")); render(<SupportInbox conversationId="conversation-1" />); expect(await screen.findByRole("alert")).toHaveTextContent("Thread unavailable"); getSupportConversation.mockResolvedValueOnce(conversation()); await user.click(screen.getByRole("button", { name: "Try again" })); expect(await screen.findByText("Registration help")).toBeInTheDocument(); });

  it("refreshes summaries after marking a thread read", async () => { render(<SupportInbox conversationId="conversation-1" />); await waitFor(() => expect(markSupportConversationRead).toHaveBeenCalledWith("conversation-1")); await waitFor(() => expect(listSupportConversations).toHaveBeenCalledTimes(2)); });

  it("refreshes again when realtime invalidates a pending list request", async () => {
    let resolveList!: (value: { items: SupportConversationSummary[]; nextCursor: null }) => void;
    const pendingList = new Promise<{ items: SupportConversationSummary[]; nextCursor: null }>((resolve) => { resolveList = resolve; });
    let onRealtimeUpdate!: () => void;
    listSupportConversations.mockReset();
    listSupportConversations.mockImplementationOnce(() => pendingList).mockResolvedValue({ items: [], nextCursor: null });
    subscribeToRealtimeUpdates.mockImplementationOnce((_topic: string, callback: () => void) => { onRealtimeUpdate = callback; return vi.fn(); });

    render(<SupportInbox />);
    await waitFor(() => expect(listSupportConversations).toHaveBeenCalledTimes(1));
    act(() => { onRealtimeUpdate(); });
    expect(listSupportConversations).toHaveBeenCalledTimes(1);

    resolveList({ items: [], nextCursor: null });
    await waitFor(() => expect(listSupportConversations).toHaveBeenCalledTimes(2));
  });

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

  it("clears the inbox and thread immediately when the authenticated user changes", async () => {
    let resolveNextList!: (value: { items: SupportConversationSummary[]; nextCursor: null }) => void;
    let resolveNextThread!: (value: SupportConversation) => void;
    const pendingList = new Promise<{ items: SupportConversationSummary[]; nextCursor: null }>((resolve) => { resolveNextList = resolve; });
    const pendingThread = new Promise<SupportConversation>((resolve) => { resolveNextThread = resolve; });
    const oldItem = { ...conversation("OPEN", "conversation-1", "Old user conversation"), lastMessage: null, preview: null };

    listSupportConversations.mockReset();
    listSupportConversations.mockResolvedValueOnce({ items: [oldItem], nextCursor: null }).mockResolvedValueOnce({ items: [oldItem], nextCursor: null }).mockImplementation(() => pendingList);
    getSupportConversation.mockReset();
    getSupportConversation.mockResolvedValueOnce(conversation("OPEN", "conversation-1", "Old user conversation")).mockImplementation(() => pendingThread);

    const view = render(<SupportInbox conversationId="conversation-1" />);
    expect((await screen.findAllByText("Old user conversation")).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText("I need help")).toBeInTheDocument();

    mocks.auth.user = { id: "user-2" };
    view.rerender(<SupportInbox conversationId="conversation-1" />);

    expect(screen.getByText("Loading your conversations…")).toBeInTheDocument();
    expect(screen.queryByText("Old user conversation")).not.toBeInTheDocument();
    expect(screen.queryByText("I need help")).not.toBeInTheDocument();

    resolveNextList({ items: [], nextCursor: null });
    resolveNextThread(conversation("OPEN", "conversation-2", "New user conversation"));
    mocks.auth.user = { id: "user-1" };
  });
});

describe("support notifications", () => {
  it("navigates support notifications to the conversation thread", async () => { const user = userEvent.setup(); apiFetchJson.mockResolvedValue({ response: new Response(null, { status: 200 }), data: { success: true, data: { items: [{ id: "notification-1", type: "support_message", title: "New support message", body: "A reply is waiting", actionUrl: "/support/conversation-1", readAt: null, createdAt: "2026-08-19T12:00:00.000Z" }], unreadCount: 1, push: { enabled: false, publicKey: null }, preference: { matchPushEnabled: true, soundEnabled: true, matchEmailEnabled: false } } } }); render(<NotificationBell user={{ id: "user-1", firstName: "Player", lastName: "One", email: "player@example.com", username: "player", role: "user", emailVerified: true }} />); await waitFor(() => expect(screen.getByRole("button", { name: "1 unread notifications" })).toBeInTheDocument()); await user.click(screen.getByRole("button", { name: "1 unread notifications" })); expect(screen.getByRole("link", { name: /New support message/ })).toHaveAttribute("href", "/support/conversation-1"); });
  it("navigates staff support notifications to the admin conversation query", async () => { const user = userEvent.setup(); apiFetchJson.mockResolvedValue({ response: new Response(null, { status: 200 }), data: { success: true, data: { items: [{ id: "notification-2", type: "support_message", title: "New support message", body: "A player is waiting", actionUrl: "/admin/support?conversationId=conversation-1", readAt: null, createdAt: "2026-08-19T12:00:00.000Z" }], unreadCount: 1, push: { enabled: false, publicKey: null }, preference: { matchPushEnabled: true, soundEnabled: true, matchEmailEnabled: false } } } }); render(<NotificationBell user={{ id: "staff-1", firstName: "Quest", lastName: "Staff", email: "staff@example.com", username: "staff", role: "admin", emailVerified: true }} />); await waitFor(() => expect(screen.getByRole("button", { name: "1 unread notifications" })).toBeInTheDocument()); await user.click(screen.getByRole("button", { name: "1 unread notifications" })); expect(screen.getByRole("link", { name: /New support message/ })).toHaveAttribute("href", "/admin/support?conversationId=conversation-1"); });
  it("shows a retryable polling failure without replacing existing notifications", async () => {
    apiFetchJson.mockRejectedValueOnce(new Error("Notification service unavailable")).mockResolvedValueOnce({
      response: new Response(null, { status: 200 }),
      data: { success: true, data: { items: [], unreadCount: 0, push: { enabled: false, publicKey: null }, preference: { matchPushEnabled: true, soundEnabled: true, matchEmailEnabled: false } } },
    });
    const user = userEvent.setup();
    render(<NotificationBell user={{ id: "user-1", firstName: "Player", lastName: "One", email: "player@example.com", username: "player", role: "user", emailVerified: true }} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Notification service unavailable"));
    await user.click(screen.getByRole("button", { name: "0 unread notifications" }));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  const bellUser = { id: "user-1", firstName: "Player", lastName: "One", email: "player@example.com", username: "player", role: "user" as const, emailVerified: true };
  const unreadItem = { id: "notification-1", type: "match", title: "Match ready", body: "Join now", actionUrl: null, readAt: null, createdAt: "2026-08-19T12:00:00.000Z" };
  const bellPayload = (items: Array<typeof unreadItem>, unreadCount: number) => ({
    response: new Response(null, { status: 200 }),
    data: { success: true, data: { items, unreadCount, push: { enabled: false, publicKey: null }, preference: { matchPushEnabled: true, soundEnabled: true, matchEmailEnabled: false } } },
  });
  const signalOf = (path: string) => {
    const call = apiFetchJson.mock.calls.find(([requested]) => String(requested).endsWith(path));
    expect(call, `no request for ${path}`).toBeDefined();
    return call![1] as { method?: string; signal?: AbortSignal };
  };

  it("aborts an in-flight read mutation and ignores it once the account changes", async () => {
    apiFetchJson.mockImplementation((path: string) => path.endsWith("/read")
      ? new Promise(() => {})
      : Promise.resolve(bellPayload([unreadItem], 1)));

    const view = render(<NotificationBell user={bellUser} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "1 unread notifications" })).toBeInTheDocument());
    await userEvent.setup().click(screen.getByRole("button", { name: "1 unread notifications" }));
    fireEvent.click(screen.getByRole("link", { name: /Match ready/ }));

    const readOptions = signalOf("/read");
    expect(readOptions.method).toBe("PATCH");
    expect(readOptions.signal).toBeInstanceOf(AbortSignal);
    expect(readOptions.signal!.aborted).toBe(false);

    apiFetchJson.mockImplementation(() => Promise.resolve(bellPayload([], 0)));
    view.rerender(<NotificationBell user={{ ...bellUser, id: "user-2" }} />);

    await waitFor(() => expect(readOptions.signal!.aborted).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "0 unread notifications" })).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends mark-all-read with an abort signal and refreshes afterwards", async () => {
    apiFetchJson.mockImplementation((path: string) => path.endsWith("/read-all")
      ? Promise.resolve({ response: new Response(null, { status: 200 }), data: { success: true } })
      : Promise.resolve(bellPayload([unreadItem], 1)));

    const user = userEvent.setup();
    render(<NotificationBell user={bellUser} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "1 unread notifications" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "1 unread notifications" }));
    await user.click(screen.getByRole("button", { name: "Mark all read" }));

    const readAllOptions = signalOf("/read-all");
    expect(readAllOptions.method).toBe("PATCH");
    expect(readAllOptions.signal).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(apiFetchJson.mock.calls.filter(([path]) => String(path).startsWith("/api/v1/notifications?")).length).toBeGreaterThan(1));
  });

  it("surfaces a failed mark-all-read instead of rejecting silently", async () => {
    apiFetchJson.mockImplementation((path: string) => path.endsWith("/read-all")
      ? Promise.reject(new Error("Mark all read failed."))
      : Promise.resolve(bellPayload([unreadItem], 1)));

    const user = userEvent.setup();
    render(<NotificationBell user={bellUser} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "1 unread notifications" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "1 unread notifications" }));
    await user.click(screen.getByRole("button", { name: "Mark all read" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Mark all read failed.");
  });

  it("drops a stale notification response when the signed-in user changes", async () => {
    let resolveOld!: (value: unknown) => void;
    const oldRequest = new Promise((resolve) => { resolveOld = resolve; });
    const response = (title: string) => ({
      response: new Response(null, { status: 200 }),
      data: { success: true, data: {
        items: [{ id: title, type: "match", title, body: "body", actionUrl: null, readAt: null, createdAt: "2026-08-19T12:00:00.000Z" }],
        unreadCount: 1,
        push: { enabled: false, publicKey: null },
        preference: { matchPushEnabled: true, soundEnabled: true, matchEmailEnabled: false },
      } },
    });
    apiFetchJson.mockReturnValueOnce(oldRequest).mockResolvedValueOnce(response("New account alert"));

    const view = render(<NotificationBell user={{ id: "user-1", firstName: "Old", lastName: "User", email: "old@example.com", username: "old", role: "user", emailVerified: true }} />);
    view.rerender(<NotificationBell user={{ id: "user-2", firstName: "New", lastName: "User", email: "new@example.com", username: "new", role: "user", emailVerified: true }} />);
    await waitFor(() => expect(apiFetchJson).toHaveBeenCalledTimes(2));
    await act(async () => { resolveOld(response("Old account alert")); });

    await userEvent.setup().click(screen.getByRole("button", { name: "1 unread notifications" }));
    expect(await screen.findByText("New account alert")).toBeInTheDocument();
    expect(screen.queryByText("Old account alert")).not.toBeInTheDocument();
  });
});
