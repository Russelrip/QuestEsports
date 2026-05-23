"use client";

import { useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { useAdminMessages } from "@/hooks/api/useAdmin";
import { useToastStore } from "@/hooks/useToastStore";
import { adminRequest, getAdminPaginationSummary } from "@/lib/admin";

export default function AdminContactMessagesManager() {
  const [search, setSearch] = useState("");
  const [isRead, setIsRead] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, refetch } = useAdminMessages(search, isRead, page);
  const showToast = useToastStore((state) => state.showToast);

  const messages = data?.messages || [];
  const pagination = data?.pagination;

  const updateReadStatus = async (messageId: string, nextIsRead: boolean) => {
    try {
      await adminRequest(`/api/admin/contact-messages/${messageId}`, {
        method: "PATCH",
        json: { isRead: nextIsRead },
      });
      showToast({ tone: "success", title: nextIsRead ? "Marked as read" : "Marked as unread" });
      await refetch();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to update message",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!window.confirm("Delete this contact message?")) {
      return;
    }

    try {
      await adminRequest(`/api/admin/contact-messages/${messageId}`, { method: "DELETE" });
      showToast({ tone: "success", title: "Message deleted" });
      await refetch();
    } catch (nextError) {
      showToast({
        tone: "error",
        title: "Unable to delete message",
        description: nextError instanceof Error ? nextError.message : "Request failed.",
      });
    }
  };

  return (
    <AdminShell
      title="Contact Messages"
      description="Review support and partnership messages, update read status, and clear spam quickly."
    >
      <Card className="p-6 sm:p-8">
        <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h3 className="text-2xl text-white">Inbox</h3>
            <p className="text-sm text-slate-400">Monitor incoming messages from the public contact form.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sender or subject..." />
            <Select value={isRead} onChange={(event) => setIsRead(event.target.value)}>
              <option value="">All statuses</option>
              <option value="false">Unread</option>
              <option value="true">Read</option>
            </Select>
          </div>
        </div>

        {loading ? (
          <AdminTableSkeleton />
        ) : error ? (
          <EmptyState description={error} />
        ) : messages.length === 0 ? (
          <EmptyState description="No contact messages found." />
        ) : (
          <div className="grid gap-4">
            {messages.map((message) => (
              <div key={message.id} className="grid gap-4 rounded-[24px] border border-white/8 bg-white/5 p-5 xl:grid-cols-[0.85fr_1.7fr_auto]">
                <div>
                  <p className="font-semibold text-white">{message.name}</p>
                  <p className="text-sm text-slate-400">{message.email}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">{message.isRead ? "Read" : "Unread"}</p>
                </div>
                <div>
                  <p className="font-medium text-white">{message.subject}</p>
                  <p className="mt-3 text-sm leading-7 text-slate-300">{message.message}</p>
                  <p className="mt-3 text-xs text-slate-500">{new Date(message.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap gap-3 xl:flex-col xl:items-end">
                  <Button type="button" variant="secondary" onClick={() => updateReadStatus(message.id, !message.isRead)}>
                    Mark {message.isRead ? "Unread" : "Read"}
                  </Button>
                  <Button type="button" variant="danger" onClick={() => deleteMessage(message.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
            {pagination ? (
              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-400">{getAdminPaginationSummary(pagination)}</p>
                <div className="flex gap-3">
                  <Button type="button" variant="secondary" disabled={pagination.page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
                  <Button type="button" variant="secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Card>
    </AdminShell>
  );
}
