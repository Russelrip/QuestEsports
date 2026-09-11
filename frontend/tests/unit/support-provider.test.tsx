import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SupportProvider, SupportUnreadBadge, notifySupportRead } from "../../components/support/SupportProvider";
import SupportComposer from "../../components/support/SupportComposer";

const mocks = vi.hoisted(() => ({ user: { id: "one" } as { id: string } | null, unread: vi.fn(), realtime: vi.fn() }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/lib/support", () => ({ getSupportUnread: mocks.unread }));
vi.mock("@/lib/realtime", () => ({ subscribeToRealtimeUpdates: mocks.realtime }));
beforeEach(() => { vi.clearAllMocks(); mocks.user = { id: "one" }; mocks.unread.mockResolvedValue({ unreadConversations: 2 }); mocks.realtime.mockReturnValue(vi.fn()); });
afterEach(cleanup);

it("refreshes the conversation badge after reading, without counting notifications", async () => {
  render(<SupportProvider><SupportUnreadBadge /></SupportProvider>);
  expect(await screen.findByLabelText("2 conversations with unread replies")).toHaveTextContent("2");
  mocks.unread.mockResolvedValue({ unreadConversations: 0 });
  act(() => { notifySupportRead(); });
  await waitFor(() => expect(screen.queryByLabelText(/conversations with unread/)).not.toBeInTheDocument());
});

it("keeps drafts while navigating and destroys them when the account changes", async () => {
  const user = userEvent.setup();
  const view = render(<SupportProvider><SupportComposer draftKey="new" onSubmit={vi.fn()} /></SupportProvider>);
  await user.type(screen.getByLabelText(/Subject/), "Private account issue");
  await user.type(screen.getByLabelText(/Message/), "My private draft");
  view.rerender(<SupportProvider><p>Inbox</p></SupportProvider>);
  view.rerender(<SupportProvider><SupportComposer draftKey="new" onSubmit={vi.fn()} /></SupportProvider>);
  expect(screen.getByLabelText(/Message/)).toHaveValue("My private draft");
  mocks.user = { id: "two" };
  view.rerender(<SupportProvider><SupportComposer draftKey="new" onSubmit={vi.fn()} /></SupportProvider>);
  expect(screen.getByLabelText(/Message/)).toHaveValue("");
  expect(screen.getByLabelText(/Subject/)).toHaveValue("");
});

it("ignores an unread response from the previous account", async () => {
  let resolveOld!: (value: { unreadConversations: number }) => void;
  mocks.unread.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue({ unreadConversations: 0 });
  const view = render(<SupportProvider><SupportUnreadBadge /></SupportProvider>);
  mocks.user = { id: "two" };
  view.rerender(<SupportProvider><SupportUnreadBadge /></SupportProvider>);
  await act(async () => { resolveOld({ unreadConversations: 9 }); });
  expect(screen.queryByLabelText(/conversations with unread/)).not.toBeInTheDocument();
});
