"use client";

import { useCallback, useEffect, useState } from "react";
import EmptyState from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { adminRequest, formatAdminCompactDateTime, type Pagination } from "@/lib/admin";
import { type TicketEvent, type TicketOrderSummary, statusTone } from "./ticket-model";
import { Pager } from "./ticket-ui";

export function OrdersPanel({ event }: { event: TicketEvent }) {
  const [orders, setOrders] = useState<TicketOrderSummary[]>([]);
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
        orders: TicketOrderSummary[];
        pagination: Pagination;
      }>(`/api/admin/ticket-events/${event.id}/orders?${params}`);
      setOrders(data.orders);
      setPagination(data.pagination);
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Orders could not be loaded.",
      );
    }
  }, [debouncedSearch, event.id, page, status]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="grid gap-3 border-b border-white/10 p-5 sm:grid-cols-2">
        <Input
          value={search}
          onChange={(input) => {
            setSearch(input.target.value);
            setPage(1);
          }}
          placeholder="Search buyer, email, phone, or ticket…"
        />
        <Select
          value={status}
          onChange={(input) => {
            setStatus(input.target.value);
            setPage(1);
          }}
        >
          <option value="">All order statuses</option>
          {["pending_payment", "paid", "cancelled", "expired", "refunded"].map(
            (value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ),
          )}
        </Select>
      </div>
      {error ? (
        <div className="p-5">
          <EmptyState description={error} />
        </div>
      ) : !orders.length ? (
        <div className="p-5">
          <EmptyState description="No ticket orders matched these filters." />
        </div>
      ) : (
        <>
          <div className="grid gap-3 p-3 md:hidden">
            {orders.map((order) => (
              <article key={order.id} className="min-w-0 border border-white/10 bg-white/[0.03] p-4">
                <h4 className="break-words font-semibold text-white">{order.buyerName}</h4>
                <p className="mt-1 break-all text-xs text-slate-500">{order.email}</p>
                <p className="break-words text-xs text-slate-500">{order.phone}</p>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Tickets</dt><dd className="mt-1 text-slate-200">{order.quantity}</dd></div>
                  <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Total</dt><dd className="mt-1 font-semibold text-white">{order.currency} {order.total.toFixed(2)}</dd></div>
                  <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Order</dt><dd className={`mt-1 text-xs uppercase ${statusTone(order.status)}`}>{order.status.replaceAll("_", " ")}</dd></div>
                  <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">Payment</dt><dd className={`mt-1 text-xs uppercase ${statusTone(order.paymentStatus)}`}>{order.paymentStatus.replaceAll("_", " ")}</dd></div>
                </dl>
                <p className="mt-4 text-xs text-slate-500">{formatAdminCompactDateTime(order.createdAt)}</p>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-left">
              <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="p-4">Buyer</th>
                  <th className="p-4">Tickets</th>
                  <th className="p-4">Total</th>
                  <th className="p-4">Order</th>
                  <th className="p-4">Payment</th>
                  <th className="p-4">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="p-4">
                      <p className="font-semibold text-white">
                        {order.buyerName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {order.email} · {order.phone}
                      </p>
                    </td>
                    <td className="p-4 text-slate-300">{order.quantity}</td>
                    <td className="p-4 text-slate-300">
                      {order.currency} {order.total.toFixed(2)}
                    </td>
                    <td
                      className={`p-4 text-xs uppercase ${statusTone(order.status)}`}
                    >
                      {order.status.replaceAll("_", " ")}
                    </td>
                    <td
                      className={`p-4 text-xs uppercase ${statusTone(order.paymentStatus)}`}
                    >
                      {order.paymentStatus.replaceAll("_", " ")}
                    </td>
                    <td className="p-4 text-sm text-slate-400">
                      {formatAdminCompactDateTime(order.createdAt)}
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
