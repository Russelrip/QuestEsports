"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { apiFetch } from "@/lib/auth";
import { adminRequest, formatAdminCompactDateTime, getAdminPaginationSummary, type Pagination } from "@/lib/admin";

type PaymentSummary = {
  id: string;
  orderId: string;
  paymentId?: string | null;
  purpose: string;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  method?: string | null;
  createdAt: string;
  customerName: string;
  customerEmail?: string | null;
};

type PaymentDetail = Omit<PaymentSummary, "customerName" | "customerEmail"> & {
  statusMessage?: string | null;
  updatedAt: string;
  reconciledAt?: string | null;
  reconciliationNote?: string | null;
  providerRefundId?: string | null;
  registration?: {
    teamName: string;
    contactEmail: string;
    assignedSlotNumber?: number | null;
    reservedUntil?: string | null;
  } | null;
  merchandiseOrder?: { email: string } | null;
  bankTransferProof?: {
    originalFilename: string;
    contentType: string;
    byteSize: number;
    submittedAt: string;
    reviewedAt?: string | null;
    rejectionReason?: string | null;
  } | null;
};

export default function AdminPaymentsManager() {
  const [payments, setPayments] = useState<PaymentSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState("");
  const [purpose, setPurpose] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<PaymentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (status) params.set("status", status);
      if (purpose) params.set("purpose", purpose);
      const data = await adminRequest<{ payments: PaymentSummary[]; pagination: Pagination }>(`/api/admin/payments?${params}`);
      setPayments(data.payments);
      setPagination(data.pagination);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load payments.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, purpose, status]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) return;
    setDetailLoading(true);
    setDetailError("");
    try {
      const data = await adminRequest<{ payment: PaymentDetail }>(`/api/admin/payments/${selectedId}`);
      setSelectedPayment(data.payment);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Unable to load this payment.");
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!selectedId) {
      setSelectedPayment(null);
      setDetailError("");
      return;
    }
    void loadDetail();
  }, [loadDetail, selectedId]);

  const refreshDetailAndList = async () => {
    await Promise.all([refresh(), loadDetail()]);
  };

  return (
    <AdminShell title="Payment Reconciliation" description="Browse transaction summaries, then open one payment to inspect evidence and perform reconciliation actions.">
      {selectedId ? (
        <PaymentDetailView
          payment={selectedPayment}
          loading={detailLoading}
          error={detailError}
          onBack={() => setSelectedId(null)}
          onChanged={refreshDetailAndList}
        />
      ) : (
        <Card className="min-w-0 overflow-hidden">
          <div className="border-b border-white/10 p-5 sm:p-6">
            <div className="grid gap-4 lg:grid-cols-3">
              <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search reference, team, or email..." aria-label="Search payments" />
              <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                <option value="">All statuses</option>
                {["created", "pending", "paid", "failed", "cancelled", "charged_back", "expired", "review_required", "refunded"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
              </Select>
              <Select value={purpose} onChange={(event) => { setPurpose(event.target.value); setPage(1); }}>
                <option value="">All purposes</option>
                <option value="tournament_registration">Tournament registration</option>
                <option value="merchandise_order">Merchandise order</option>
              </Select>
            </div>
          </div>

          {message ? <p className="p-5 text-sm text-rose-300">{message}</p> : null}
          {loading ? (
            <div className="p-5"><AdminTableSkeleton /></div>
          ) : payments.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">No payments match these filters.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1050px] border-collapse text-left">
                  <thead className="border-b border-white/10 bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-5 py-4 font-semibold">Reference</th>
                      <th className="px-5 py-4 font-semibold">Customer</th>
                      <th className="px-5 py-4 font-semibold">Purpose</th>
                      <th className="px-5 py-4 font-semibold">Provider</th>
                      <th className="px-5 py-4 font-semibold">Amount</th>
                      <th className="px-5 py-4 font-semibold">Status</th>
                      <th className="px-5 py-4 font-semibold">Created</th>
                      <th className="px-5 py-4 text-right font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/8">
                    {payments.map((payment) => (
                      <tr key={payment.id} className={`transition hover:bg-purple-300/[0.04] ${payment.status === "review_required" ? "bg-amber-300/[0.03]" : ""}`}>
                        <td className="px-5 py-4"><p className="max-w-52 break-all text-sm font-semibold text-white">{payment.orderId}</p>{payment.paymentId ? <p className="mt-1 max-w-52 break-all text-xs text-slate-500">PayHere {payment.paymentId}</p> : null}</td>
                        <td className="px-5 py-4"><p className="text-sm text-slate-300">{payment.customerName}</p><p className="text-xs text-slate-500">{payment.customerEmail || "No email"}</p></td>
                        <td className="px-5 py-4 text-xs uppercase tracking-wider text-slate-400">{payment.purpose.replaceAll("_", " ")}</td>
                        <td className="px-5 py-4 text-sm text-slate-300">{payment.provider}</td>
                        <td className="px-5 py-4 text-sm font-semibold text-white">{payment.currency} {payment.amount.toFixed(2)}</td>
                        <td className="px-5 py-4"><PaymentStatus value={payment.status} /></td>
                        <td className="px-5 py-4 text-sm text-slate-400">{formatAdminCompactDateTime(payment.createdAt)}</td>
                        <td className="px-5 py-4 text-right"><Button type="button" variant="secondary" onClick={() => setSelectedId(payment.id)}>View & reconcile</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                <span>{getAdminPaginationSummary(pagination, "transactions")}</span>
                <div className="grid grid-cols-2 gap-2 sm:flex"><Button className="w-full sm:w-auto" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button className="w-full sm:w-auto" variant="secondary" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button></div>
              </div>
            </>
          )}
        </Card>
      )}
    </AdminShell>
  );
}

function PaymentDetailView({ payment, loading, error, onBack, onChanged }: {
  payment: PaymentDetail | null;
  loading: boolean;
  error: string;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [refundReference, setRefundReference] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    setReason("");
    setRefundReference("");
    setActionError("");
  }, [payment?.id]);

  const openProof = async () => {
    if (!payment) return;
    setBusy(true);
    try {
      const response = await apiFetch(`/api/admin/payments/${payment.id}/bank-transfer-proof`);
      if (!response.ok) throw new Error("Payment proof could not be opened.");
      const objectUrl = URL.createObjectURL(await response.blob());
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "Payment proof could not be opened.");
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (path: string, options: Parameters<typeof adminRequest>[1]) => {
    setBusy(true);
    setActionError("");
    try {
      await adminRequest(path, options);
      setReason("");
      setRefundReference("");
      await onChanged();
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "Payment action failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button type="button" variant="secondary" onClick={onBack}>← Back to payments</Button>
      {error ? <Card className="p-6 text-sm text-rose-300">{error}</Card> : null}
      {loading ? <Card className="p-5"><AdminTableSkeleton /></Card> : null}
      {!loading && payment ? (
        <Card className={`min-w-0 overflow-hidden p-5 sm:p-6 ${payment.status === "review_required" ? "border-amber-300/30" : ""}`}>
          <div className="border-b border-white/10 pb-5">
            <p className="text-xs uppercase tracking-[0.2em] text-purple-200">{payment.purpose.replaceAll("_", " ")} · {payment.provider}</p>
            <h3 className="mt-2 text-2xl text-white">{payment.currency} {payment.amount.toFixed(2)}</h3>
            <div className="mt-2"><PaymentStatus value={payment.status} /></div>
            <p className="mt-3 break-all text-sm text-slate-400">Reference {payment.orderId}{payment.paymentId ? ` · Provider ID ${payment.paymentId}` : ""}</p>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <PaymentInfo title="Transaction" rows={[
              ["Method", payment.method || "Pending"], ["Created", formatAdminCompactDateTime(payment.createdAt)],
              ["Updated", formatAdminCompactDateTime(payment.updatedAt)], ["Status message", payment.statusMessage || "None"],
            ]} />
            <PaymentInfo title="Customer" rows={payment.registration ? [
              ["Team", payment.registration.teamName], ["Email", payment.registration.contactEmail],
              ["Slot", payment.registration.assignedSlotNumber ? `#${payment.registration.assignedSlotNumber}` : "Not assigned"],
              ["Reserved until", payment.registration.reservedUntil ? formatAdminCompactDateTime(payment.registration.reservedUntil) : "Not reserved"],
            ] : [["Email", payment.merchandiseOrder?.email || "No customer email"]]} />
            <PaymentInfo title="Reconciliation" rows={[
              ["Reconciled", payment.reconciledAt ? formatAdminCompactDateTime(payment.reconciledAt) : "No"],
              ["Note", payment.reconciliationNote || "None"], ["Refund reference", payment.providerRefundId || "None"],
            ]} />
          </div>

          {payment.bankTransferProof ? (
            <div className="mt-5 grid gap-3 border border-white/10 bg-black/15 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Private bank-transfer evidence</p>
              <p className="break-words text-sm text-slate-300">{payment.bankTransferProof.originalFilename} · {Math.ceil(payment.bankTransferProof.byteSize / 1024)} KB · {payment.bankTransferProof.contentType}</p>
              <p className="text-sm text-slate-400">Submitted {formatAdminCompactDateTime(payment.bankTransferProof.submittedAt)}{payment.bankTransferProof.reviewedAt ? ` · Reviewed ${formatAdminCompactDateTime(payment.bankTransferProof.reviewedAt)}` : ""}</p>
              {payment.bankTransferProof.rejectionReason ? <p className="text-sm text-rose-300">Previous rejection: {payment.bankTransferProof.rejectionReason}</p> : null}
              <div><Button type="button" variant="secondary" disabled={busy} onClick={() => void openProof()}>Open private proof</Button></div>
            </div>
          ) : null}

          {payment.provider === "bank_transfer" && payment.bankTransferProof && payment.status === "review_required" ? (
            <div className="mt-5 grid gap-3 border border-amber-300/20 p-4">
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason required only when rejecting" rows={3} />
              <div className="grid gap-2 sm:flex sm:flex-wrap">
                <Button type="button" disabled={busy} onClick={() => void runAction(`/api/admin/payments/${payment.id}/bank-transfer-review`, { method: "PATCH", json: { decision: "approve", reason } })}>Approve verified transfer</Button>
                <Button type="button" variant="secondary" disabled={busy || !reason.trim()} onClick={() => void runAction(`/api/admin/payments/${payment.id}/bank-transfer-review`, { method: "PATCH", json: { decision: "reject", reason } })}>Reject and release slot</Button>
              </div>
            </div>
          ) : null}

          {payment.provider === "payhere" && payment.status === "review_required" ? (
            <div className="mt-5 grid gap-3 border border-amber-300/20 p-4">
              <p className="text-sm text-amber-100">Verify this payment in the PayHere merchant portal before reconciling it here.</p>
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required reconciliation note" rows={3} />
              <Input value={refundReference} onChange={(event) => setRefundReference(event.target.value)} placeholder="PayHere refund reference (required for refund)" />
              <div className="grid gap-2 sm:flex sm:flex-wrap">
                <Button type="button" disabled={busy || !reason.trim()} onClick={() => void runAction(`/api/admin/payments/${payment.id}/payhere-reconciliation`, { method: "PATCH", json: { decision: "accept", note: reason, providerRefundId: refundReference } })}>Accept verified payment</Button>
                <Button type="button" variant="secondary" disabled={busy || !reason.trim() || !refundReference.trim()} onClick={() => void runAction(`/api/admin/payments/${payment.id}/payhere-reconciliation`, { method: "PATCH", json: { decision: "mark_refunded", note: reason, providerRefundId: refundReference } })}>Record completed refund</Button>
              </div>
            </div>
          ) : null}

          {payment.purpose === "tournament_registration" && payment.status === "expired" ? (
            <div className="mt-5 border border-amber-300/20 p-4"><p className="mb-3 text-sm text-amber-100">Reopening begins a new payment window{payment.provider === "bank_transfer" ? " and assigns the lowest available slot; the slot-tier price may change" : " if tournament capacity is still available"}.</p><Button type="button" disabled={busy} onClick={() => window.confirm(`Reopen expired payment ${payment.orderId}?`) && void runAction(`/api/admin/payments/${payment.id}/reopen`, { method: "POST" })}>{busy ? "Reopening..." : "Reopen payment"}</Button></div>
          ) : null}

          {actionError ? <p className="mt-4 text-sm text-rose-300">{actionError}</p> : null}
        </Card>
      ) : null}
    </div>
  );
}

function PaymentStatus({ value }: { value: string }) {
  const tone = value === "paid" ? "text-emerald-300" : ["failed", "cancelled", "charged_back", "refunded"].includes(value) ? "text-rose-300" : "text-amber-300";
  return <span className={`text-xs font-semibold uppercase tracking-wider ${tone}`}>{value.replaceAll("_", " ")}</span>;
}

function PaymentInfo({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return <div className="border border-white/10 bg-black/15 p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p><dl className="mt-4 grid gap-3">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm text-slate-200">{value}</dd></div>)}</dl></div>;
}
