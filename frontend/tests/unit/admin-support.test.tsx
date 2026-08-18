import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminSupportManager from "../../components/admin/AdminSupportManager";
import type { SupportConversation } from "../../lib/support";

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), assign: vi.fn(), send: vi.fn(), status: vi.fn(), auth: { user: { id: "staff-1" }, isLoading: false } }));
vi.mock("@/lib/support", () => ({ listAdminSupportConversations: mocks.list, getAdminSupportConversation: mocks.get, assignSupportConversation: mocks.assign, sendAdminSupportMessage: mocks.send, updateAdminSupportStatus: mocks.status }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/components/admin/AdminShell", () => ({ default: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));

const conversation = (status: SupportConversation["status"] = "PENDING_STAFF"): SupportConversation => ({ id: "c-1", ownerUserId: "player-1", subject: "Registration help", status, assignedStaffUserId: null, createdAt: "2026-08-19T11:00:00.000Z", updatedAt: "2026-08-19T12:00:00.000Z", resolvedAt: null, owner: { id: "player-1", username: "player", firstName: "Player", lastName: "One", avatarUrl: null }, assignedStaff: null, unreadCount: 1, messages: [{ id: "m-1", conversationId: "c-1", senderUserId: "player-1", body: "Please help", createdAt: "2026-08-19T12:00:00.000Z", sender: null }] });
const summary = { ...conversation(), lastMessage: conversation().messages[0], preview: "Please help" };

beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ items: [summary], nextCursor: null }); mocks.get.mockResolvedValue(conversation()); mocks.assign.mockResolvedValue(conversation()); mocks.send.mockResolvedValue({ message: { ...conversation().messages[0], id: "m-2", senderUserId: "staff-1", body: "We can help" }, status: "PENDING_USER" }); mocks.status.mockResolvedValue(conversation("RESOLVED")); });
afterEach(() => cleanup());

describe("admin support queue", () => {
  it("filters the queue and opens a thread", async () => { const user = userEvent.setup(); render(<AdminSupportManager />); await screen.findByText("Registration help"); await user.selectOptions(screen.getByLabelText("Filter by status"), "RESOLVED"); await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith({ assigned: "all", status: "RESOLVED" })); await user.click(screen.getByRole("button", { name: /Registration help/ })); expect(await screen.findByText("Private support thread")).toBeInTheDocument(); });
  it("assigns to me, replies, and resolves", async () => { const user = userEvent.setup(); render(<AdminSupportManager />); await user.click(await screen.findByRole("button", { name: /Registration help/ })); await user.selectOptions(await screen.findByLabelText("Conversation owner"), "staff-1"); await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith("c-1", "staff-1")); await user.type(screen.getByLabelText(/Reply to/), "We can help"); await user.click(screen.getByRole("button", { name: "Send reply" })); await waitFor(() => expect(mocks.send).toHaveBeenCalledWith("c-1", "We can help")); await user.click(screen.getByRole("button", { name: "Resolve" })); await waitFor(() => expect(mocks.status).toHaveBeenCalledWith("c-1", "RESOLVED")); });
  it("shows retry and authorization errors", async () => { mocks.list.mockRejectedValueOnce(new Error("Staff authorization is required.")); render(<AdminSupportManager />); expect(await screen.findByRole("alert")).toHaveTextContent("Staff authorization is required."); expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument(); });
  it("shows a useful empty state", async () => { mocks.list.mockResolvedValue({ items: [], nextCursor: null }); render(<AdminSupportManager />); expect(await screen.findByText("Queue is clear")).toBeInTheDocument(); });
});
