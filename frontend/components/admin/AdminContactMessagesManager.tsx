"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/EmptyState";
import {
  ContactMessage,
  Pagination,
  adminRequest,
  emptyPagination,
} from "@/lib/admin";

const formatDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function AdminContactMessagesManager() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [pagination, setPagination] = useState<Pagination>(emptyPagination);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [isRead, setIsRead] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "10",
      });

      if (search.trim()) {
        params.set("search", search.trim());
      }
      if (isRead) {
        params.set("isRead", isRead);
      }

      const data = await adminRequest<{
        messages: ContactMessage[];
        pagination: Pagination;
      }>(`/api/admin/contact-messages?${params.toString()}`);

      setMessages(data.messages);
      setPagination(data.pagination);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load contact messages."
      );
    } finally {
      setLoading(false);
    }
  }, [isRead, page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateReadStatus = async (messageId: string, nextIsRead: boolean) => {
    try {
      const data = await adminRequest<{ contactMessage: ContactMessage }>(
        `/api/admin/contact-messages/${messageId}`,
        {
          method: "PATCH",
          json: { isRead: nextIsRead },
        }
      );

      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? data.contactMessage : message
        )
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to update contact message."
      );
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!window.confirm("Delete this contact message?")) {
      return;
    }

    try {
      await adminRequest(`/api/admin/contact-messages/${messageId}`, {
        method: "DELETE",
      });
      setMessages((current) => current.filter((message) => message.id !== messageId));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to delete contact message."
      );
    }
  };

  return (
    <AdminShell
      title="Contact Messages"
      description="Review incoming messages, mark them read or unread, and remove spam."
    >
      <div className="admin-users-card">
        <div className="admin-users-head">
          <div>
            <h3>Inbox</h3>
            <p>Monitor questions and partnership requests coming from the website.</p>
          </div>
          <div className="admin-filter-row">
            <input
              type="search"
              className="admin-search-input"
              value={search}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
              placeholder="Search sender or subject..."
            />
            <select
              value={isRead}
              onChange={(event) => {
                setPage(1);
                setIsRead(event.target.value);
              }}
            >
              <option value="">All statuses</option>
              <option value="false">Unread</option>
              <option value="true">Read</option>
            </select>
          </div>
        </div>

        {loading ? (
          <EmptyState description="Loading contact messages..." />
        ) : error ? (
          <EmptyState description={error} />
        ) : messages.length === 0 ? (
          <EmptyState description="No contact messages found." />
        ) : (
          <>
            <div className="admin-users-table-wrap">
              <table className="admin-users-table">
                <thead>
                  <tr>
                    <th>Sender</th>
                    <th>Subject</th>
                    <th>Message</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((message) => (
                    <tr key={message.id}>
                      <td>
                        <strong>{message.name}</strong>
                        <br />
                        <small>{message.email}</small>
                      </td>
                      <td>{message.subject}</td>
                      <td className="admin-message-cell">{message.message}</td>
                      <td>{formatDate(message.createdAt)}</td>
                      <td>{message.isRead ? "Read" : "Unread"}</td>
                      <td>
                        <div className="admin-table-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            onClick={() => updateReadStatus(message.id, !message.isRead)}
                          >
                            Mark {message.isRead ? "Unread" : "Read"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small admin-danger-button"
                            onClick={() => deleteMessage(message.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-pagination">
              <p>
                Page {pagination.page} of {pagination.totalPages} - {pagination.total} total
              </p>
              <div className="admin-pagination-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
