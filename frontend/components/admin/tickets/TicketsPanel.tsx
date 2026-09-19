"use client";

import { useCallback, useEffect, useState } from "react";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { adminRequest, formatAdminCompactDateTime, type Pagination } from "@/lib/admin";
import { type TicketEvent, type TicketSummary, statusTone } from "./ticket-model";
import { Pager } from "./ticket-ui";

export function TicketsPanel({
  event,
  onRefresh,
}: {
  event: TicketEvent;
  onRefresh: () => Promise<void>;
}) {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "25",
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (status) params.set("status", status);
      const data = await adminRequest<{
        tickets: TicketSummary[];
        pagination: Pagination;
      }>(`/api/admin/ticket-events/${event.id}/tickets?${params}`);
      setTickets(data.tickets);
      setPagination(data.pagination);
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Tickets could not be loaded.",
      );
    }
  }, [debouncedSearch, event.id, page, status]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const action = async (
    path: string,
    options: { method: "POST" | "PATCH"; json?: unknown },
  ) => {
    try {
      await adminRequest(path, options);
      await Promise.all([load(), onRefresh()]);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Ticket could not be updated.",
      );
    }
  };
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="grid gap-3 border-b border-white/10 p-5 sm:grid-cols-2">
        <Input
          value={search}
          onChange={(input) => {
            setSearch(input.target.value);
            setPage(1);
          }}
          placeholder="Search ticket or buyer…"
        />
        <Select
          value={status}
          onChange={(input) => {
            setStatus(input.target.value);
            setPage(1);
          }}
        >
          <option value="">All ticket statuses</option>
          {["pending", "valid", "checked_in", "cancelled", "refunded"].map(
            (value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ),
          )}
        </Select>
      </div>
      {error ? <p className="p-5 text-sm text-rose-300">{error}</p> : null}
      {!tickets.length ? (
        <div className="p-5">
          <EmptyState description="No issued tickets matched these filters." />
        </div>
      ) : (
        <>
          <div className="grid gap-3 p-3 md:hidden">
            {tickets.map((ticket) => (
              <article key={ticket.id} className="min-w-0 border border-white/10 bg-white/[0.03] p-4">
                <p className="break-all font-mono text-sm text-white">{ticket.ticketNumber}</p>
                <div className="mt-3 min-w-0">
                  <h4 className="break-words text-sm font-semibold text-white">{ticket.buyerName}</h4>
                  <p className="mt-1 break-all text-xs text-slate-500">{ticket.email}</p>
                  <p className="break-words text-xs text-slate-500">{ticket.phone}</p>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Status</dt><dd className={`mt-1 text-xs uppercase ${statusTone(ticket.status)}`}>{ticket.status.replaceAll("_", " ")}</dd></div>
                  <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Check-in</dt><dd className="mt-1 break-words text-xs text-slate-400">{ticket.checkedInAt ? `${formatAdminCompactDateTime(ticket.checkedInAt)}${ticket.checkedInBy ? ` · ${ticket.checkedInBy}` : ""}` : "Not checked in"}</dd></div>
                </dl>
                <div className="mt-4 border-t border-white/10 pt-4">
                  <TicketActions ticket={ticket} eventId={event.id} onAction={action} />
                </div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] text-left">
              <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="p-4">Ticket</th>
                  <th className="p-4">Buyer</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Check-in</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="p-4 font-mono text-sm text-white">
                      {ticket.ticketNumber}
                    </td>
                    <td className="p-4">
                      <p className="text-sm text-white">{ticket.buyerName}</p>
                      <p className="text-xs text-slate-500">
                        {ticket.email} · {ticket.phone}
                      </p>
                    </td>
                    <td
                      className={`p-4 text-xs uppercase ${statusTone(ticket.status)}`}
                    >
                      {ticket.status.replaceAll("_", " ")}
                    </td>
                    <td className="p-4 text-xs text-slate-400">
                      {ticket.checkedInAt
                        ? `${formatAdminCompactDateTime(ticket.checkedInAt)}${ticket.checkedInBy ? ` · ${ticket.checkedInBy}` : ""}`
                        : "Not checked in"}
                    </td>
                    <td className="p-4">
                      <TicketActions ticket={ticket} eventId={event.id} onAction={action} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager pagination={pagination} setPage={setPage} />
        </>
      )}
    </Card>
  );
}

function TicketActions({
  ticket,
  eventId,
  onAction,
}: {
  ticket: TicketSummary;
  eventId: string;
  onAction: (path: string, options: { method: "POST" | "PATCH"; json?: unknown }) => Promise<void>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
      {ticket.status === "valid" ? (
        <>
          <Button type="button" variant="secondary" onClick={() => void onAction(`/api/admin/ticket-events/${eventId}/tickets/${ticket.id}/check-in`, { method: "POST" })}>
            Check in
          </Button>
          <Button type="button" variant="ghost" onClick={() => window.confirm("Invalidate this ticket?") && void onAction(`/api/admin/tickets/${ticket.id}`, { method: "PATCH", json: { status: "cancelled" } })}>
            Cancel
          </Button>
          <Button type="button" variant="ghost" onClick={() => window.confirm("Replace this QR code? The old code will stop working.") && void onAction(`/api/admin/tickets/${ticket.id}/reissue`, { method: "POST" })}>
            Reissue
          </Button>
        </>
      ) : ticket.status === "cancelled" && ticket.orderStatus === "paid" ? (
        <Button type="button" variant="secondary" onClick={() => void onAction(`/api/admin/tickets/${ticket.id}`, { method: "PATCH", json: { status: "valid" } })}>
          Restore
        </Button>
      ) : null}
    </div>
  );
}
