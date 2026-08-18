import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";

export type SupportStatus = "OPEN" | "PENDING_USER" | "PENDING_STAFF" | "RESOLVED";
export type SupportUser = { id: string; username: string | null; firstName: string | null; lastName: string | null; avatarUrl: string | null };
export type SupportMessage = { id: string; conversationId: string; senderUserId: string | null; body: string; createdAt: string; sender: SupportUser | null };
export type SupportConversationSummary = { id: string; ownerUserId: string; subject: string; status: SupportStatus; assignedStaffUserId: string | null; createdAt: string; updatedAt: string; resolvedAt: string | null; owner: SupportUser | null; assignedStaff: SupportUser | null; lastMessage: SupportMessage | null; preview: string | null; unreadCount: number };
export type SupportConversation = Omit<SupportConversationSummary, "lastMessage" | "preview"> & { messages: SupportMessage[] };
type Envelope<T> = { success?: boolean; data?: T; message?: string };

async function request<T>(path: string, options: Parameters<typeof apiFetchJson>[1] = {}) {
  const { response, data } = await apiFetchJson<Envelope<T>>(path, options);
  if (!response.ok || data.success === false || data.data === undefined) throw new Error(getApiErrorMessage(response, data, "Support could not be loaded."));
  return data.data;
}

export const listSupportConversations = () => request<{ items: SupportConversationSummary[]; nextCursor: string | null }>("/api/support/conversations");
export const getSupportConversation = (id: string) => request<SupportConversation>(`/api/support/conversations/${id}`);
export const createSupportConversation = (subject: string, body: string) => request<SupportConversation>("/api/support/conversations", { method: "POST", json: { subject, body } });
export const sendSupportMessage = (id: string, body: string) => request<{ message: SupportMessage; status: SupportStatus }>(`/api/support/conversations/${id}/messages`, { method: "POST", json: { body } });
export const markSupportConversationRead = (id: string) => request<{ lastReadAt: string; unreadCount: number }>(`/api/support/conversations/${id}/read`, { method: "PATCH", json: {} });
export const resolveSupportConversation = (id: string) => request<SupportConversation>(`/api/support/conversations/${id}/resolve`, { method: "POST", json: {} });
export const reopenSupportConversation = (id: string) => request<SupportConversation>(`/api/support/conversations/${id}/reopen`, { method: "POST", json: {} });
