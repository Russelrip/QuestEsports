import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";

export type SupportStatus = "OPEN" | "PENDING_USER" | "PENDING_STAFF" | "RESOLVED";
export type SupportUser = { id: string; username: string | null; firstName: string | null; lastName: string | null; avatarUrl: string | null };
export type SupportAttachment = { id: string; position: number; contentType: "image/jpeg" | "image/png" | "image/webp"; byteSize: number; contentUrl: string };
export type SupportMessage = { id: string; conversationId: string; senderUserId: string | null; body: string; createdAt: string; sender: SupportUser | null; attachments?: SupportAttachment[] };
export type SupportConversationSummary = { id: string; ownerUserId: string; subject: string; status: SupportStatus; assignedStaffUserId: string | null; createdAt: string; updatedAt: string; resolvedAt: string | null; owner: SupportUser | null; assignedStaff: SupportUser | null; lastMessage: SupportMessage | null; preview: string | null; unreadCount: number };
export type SupportConversation = Omit<SupportConversationSummary, "lastMessage" | "preview"> & { messages: SupportMessage[] };
export type SupportMeta = { serverNow: string };
export type SupportEnvelope<T> = { success: true; data: T; meta: SupportMeta; message?: string };

async function request<T>(path: string, options: Parameters<typeof apiFetchJson>[1] = {}) {
  const { response, data } = await apiFetchJson<SupportEnvelope<T> | { success: false; message?: string }>(path, options);
  if (!response.ok || data.success !== true || !data.data || !data.meta?.serverNow) throw new Error(getApiErrorMessage(response, data, "Support could not be loaded."));
  return data.data;
}

export const listSupportConversations = (cursor?: string) => request<{ items: SupportConversationSummary[]; nextCursor: string | null }>(`/api/v1/support/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
export const getSupportUnread = (signal?: AbortSignal) => request<{ unreadConversations: number }>("/api/v1/support/unread", { signal });
export const getSupportConversation = (id: string) => request<SupportConversation>(`/api/v1/support/conversations/${id}`);
const multipartBody = (fields: Record<string, string>, screenshots: File[]) => {
  const formData = new FormData();
  Object.entries(fields).forEach(([key, value]) => formData.append(key, value));
  screenshots.forEach((screenshot) => formData.append("screenshots", screenshot, screenshot.name));
  return formData;
};
export const createSupportConversation = (subject: string, body: string, screenshots: File[] = []) => request<SupportConversation>(
  "/api/v1/support/conversations",
  screenshots.length ? { method: "POST", body: multipartBody({ subject, body }, screenshots) } : { method: "POST", json: { subject, body } },
);
export const sendSupportMessage = (id: string, body: string, screenshots: File[] = []) => request<{ message: SupportMessage; status: SupportStatus }>(
  `/api/v1/support/conversations/${id}/messages`,
  screenshots.length ? { method: "POST", body: multipartBody({ body }, screenshots) } : { method: "POST", json: { body } },
);
export const markSupportConversationRead = (id: string, throughMessageId?: string) => request<{ lastReadAt: string; unreadCount: number }>(`/api/v1/support/conversations/${id}/read`, { method: "PATCH", json: { throughMessageId } });
export const resolveSupportConversation = (id: string) => request<SupportConversation>(`/api/v1/support/conversations/${id}/resolve`, { method: "POST", json: {} });
export const reopenSupportConversation = (id: string) => request<SupportConversation>(`/api/v1/support/conversations/${id}/reopen`, { method: "POST", json: {} });

export type SupportQueueFilters = { status?: SupportStatus; assigned?: "all" | "unassigned" | "mine"; search?: string };

const buildAdminQuery = (filters: SupportQueueFilters = {}) => {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.assigned && filters.assigned !== "all") query.set("assigned", filters.assigned);
  if (filters.search?.trim()) query.set("search", filters.search.trim());
  const value = query.toString();
  return value ? `?${value}` : "";
};

export const listAdminSupportConversations = (filters?: SupportQueueFilters) =>
  request<{ items: SupportConversationSummary[]; nextCursor: string | null }>(`/api/v1/admin/support/conversations${buildAdminQuery(filters)}`);
export const getAdminSupportConversation = (id: string) => request<SupportConversation>(`/api/v1/admin/support/conversations/${id}`);
export const markAdminSupportConversationRead = (id: string) => request<{ lastReadAt: string; unreadCount: number }>(`/api/v1/admin/support/conversations/${id}/read`, { method: "PATCH", json: {} });
export const assignSupportConversation = (id: string, assignedStaffUserId: string | null) =>
  request<SupportConversation>(`/api/v1/admin/support/conversations/${id}/assignment`, { method: "PATCH", json: { assignedStaffUserId } });
export const sendAdminSupportMessage = (id: string, body: string, screenshots: File[] = []) =>
  request<{ message: SupportMessage; status: SupportStatus }>(
    `/api/v1/admin/support/conversations/${id}/messages`,
    screenshots.length ? { method: "POST", body: multipartBody({ body }, screenshots) } : { method: "POST", json: { body } },
  );
export const updateAdminSupportStatus = (id: string, status: SupportStatus) =>
  request<SupportConversation>(`/api/v1/admin/support/conversations/${id}/status`, { method: "PATCH", json: { status } });
