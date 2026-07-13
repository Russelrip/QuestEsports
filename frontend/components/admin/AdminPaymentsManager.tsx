"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { adminRequest } from "@/lib/admin";

type Payment = { id: string; orderId: string; paymentId?: string | null; purpose: string; amount: number; currency: string; status: string; method?: string | null; statusMessage?: string | null; createdAt: string; registration?: { teamName: string; contactEmail: string } | null; merchandiseOrder?: { email: string } | null };
type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

export default function AdminPaymentsManager() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [purpose, setPurpose] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const refresh = async () => {
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "50" });
        if (status) params.set("status", status);
        if (purpose) params.set("purpose", purpose);
        const data = await adminRequest<{ payments: Payment[]; pagination: Pagination }>(`/api/admin/payments?${params}`);
        setPayments(data.payments);
        setPagination(data.pagination);
        setMessage("");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to load payments.");
      }
    };
    void refresh();
  }, [page, purpose, status]);

  return <AdminShell title="Payment Reconciliation" description="Review provider notifications. Transactions requiring review must be refunded or reconciled outside automatic fulfilment.">
    <Card className="grid gap-4 p-5 sm:grid-cols-2"><Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{["created", "pending", "paid", "failed", "cancelled", "charged_back", "expired", "review_required"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</Select><Select value={purpose} onChange={(event) => { setPurpose(event.target.value); setPage(1); }}><option value="">All purposes</option><option value="tournament_registration">Tournament registration</option><option value="merchandise_order">Merchandise order</option></Select></Card>
    {message ? <p className="mt-4 text-sm text-rose-300">{message}</p> : null}
    <div className="mt-4 grid gap-4">{payments.map((payment) => <Card key={payment.id} className={`p-5 ${payment.status === "review_required" ? "border-amber-300/30" : ""}`}><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.2em] text-cyan-200">{payment.purpose.replaceAll("_", " ")}</p><h3 className="mt-2 text-xl text-white">{payment.currency} {payment.amount.toFixed(2)} · {payment.status.replaceAll("_", " ")}</h3><p className="mt-2 break-all text-sm text-slate-400">Order {payment.orderId}{payment.paymentId ? ` · PayHere ${payment.paymentId}` : ""}</p><p className="mt-1 text-sm text-slate-400">{payment.registration?.contactEmail || payment.merchandiseOrder?.email || "No customer email"}</p>{payment.statusMessage ? <p className="mt-2 text-sm text-amber-100">{payment.statusMessage}</p> : null}</div><div className="text-right text-sm text-slate-400"><p>{payment.method || "Method pending"}</p><p>{new Date(payment.createdAt).toLocaleString()}</p></div></div></Card>)}{payments.length === 0 ? <Card className="p-6 text-sm text-slate-400">No payments match these filters.</Card> : null}</div>
    <div className="mt-5 flex items-center justify-between text-sm text-slate-400"><span>{pagination.total} transactions · page {pagination.page} of {pagination.totalPages}</span><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button variant="secondary" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div>
  </AdminShell>;
}
