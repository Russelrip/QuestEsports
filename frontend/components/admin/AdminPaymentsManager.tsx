"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/auth";
import { adminRequest } from "@/lib/admin";

type Payment = {
  id: string;
  orderId: string;
  paymentId?: string | null;
  purpose: string;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  method?: string | null;
  statusMessage?: string | null;
  createdAt: string;
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

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

export default function AdminPaymentsManager() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [purpose, setPurpose] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [refundReferences, setRefundReferences] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
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
  }, [page, purpose, status]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openProof = async (payment: Payment) => {
    setBusyId(payment.id);
    try {
      const response = await apiFetch(`/api/admin/payments/${payment.id}/bank-transfer-proof`);
      if (!response.ok) throw new Error("Payment proof could not be opened.");
      const objectUrl = URL.createObjectURL(await response.blob());
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment proof could not be opened.");
    } finally {
      setBusyId("");
    }
  };

  const review = async (payment: Payment, decision: "approve" | "reject") => {
    setBusyId(payment.id);
    try {
      await adminRequest(`/api/admin/payments/${payment.id}/bank-transfer-review`, {
        method: "PATCH",
        json: { decision, reason: reasons[payment.id] || "" },
      });
      setReasons((current) => ({ ...current, [payment.id]: "" }));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment review could not be saved.");
    } finally {
      setBusyId("");
    }
  };

  const reconcilePayHere = async (payment: Payment, decision: "accept" | "mark_refunded") => {
    setBusyId(payment.id);
    try {
      await adminRequest(`/api/admin/payments/${payment.id}/payhere-reconciliation`, {
        method: "PATCH",
        json: {
          decision,
          note: reasons[payment.id] || "",
          providerRefundId: refundReferences[payment.id] || "",
        },
      });
      setReasons((current) => ({ ...current, [payment.id]: "" }));
      setRefundReferences((current) => ({ ...current, [payment.id]: "" }));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment reconciliation could not be saved.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <AdminShell title="Payment Reconciliation" description="Verify manual transfers against the actual bank credit before approving them. An uploaded receipt alone is not proof of settlement.">
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {["created", "pending", "paid", "failed", "cancelled", "charged_back", "expired", "review_required", "refunded"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
        </Select>
        <Select value={purpose} onChange={(event) => { setPurpose(event.target.value); setPage(1); }}>
          <option value="">All purposes</option>
          <option value="tournament_registration">Tournament registration</option>
          <option value="merchandise_order">Merchandise order</option>
        </Select>
      </Card>
      {message ? <p className="mt-4 text-sm text-rose-300">{message}</p> : null}
      <div className="mt-4 grid gap-4">
        {payments.map((payment) => (
          <Card key={payment.id} className={`p-5 ${payment.status === "review_required" ? "border-amber-300/30" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-purple-200">{payment.purpose.replaceAll("_", " ")} · {payment.provider}</p>
                <h3 className="mt-2 text-xl text-white">{payment.currency} {payment.amount.toFixed(2)} · {payment.status.replaceAll("_", " ")}</h3>
                <p className="mt-2 break-all text-sm text-slate-400">Reference {payment.orderId}{payment.paymentId ? ` · PayHere ${payment.paymentId}` : ""}</p>
                <p className="mt-1 text-sm text-slate-400">{payment.registration?.contactEmail || payment.merchandiseOrder?.email || "No customer email"}{payment.registration?.assignedSlotNumber ? ` · Slot #${payment.registration.assignedSlotNumber}` : ""}</p>
                {payment.statusMessage ? <p className="mt-2 text-sm text-amber-100">{payment.statusMessage}</p> : null}
              </div>
              <div className="text-right text-sm text-slate-400"><p>{payment.method || "Method pending"}</p><p>{new Date(payment.createdAt).toLocaleString()}</p></div>
            </div>
            {payment.provider === "bank_transfer" && payment.bankTransferProof ? (
              <div className="mt-5 grid gap-3 rounded-[20px] border border-white/10 p-4">
                <p className="text-sm text-slate-300">Receipt: {payment.bankTransferProof.originalFilename} · {Math.ceil(payment.bankTransferProof.byteSize / 1024)} KB · submitted {new Date(payment.bankTransferProof.submittedAt).toLocaleString()}</p>
                <div><Button type="button" variant="secondary" disabled={busyId === payment.id} onClick={() => void openProof(payment)}>Open private proof</Button></div>
                {payment.status === "review_required" ? (
                  <>
                    <Textarea value={reasons[payment.id] || ""} onChange={(event) => setReasons((current) => ({ ...current, [payment.id]: event.target.value }))} placeholder="Reason required only when rejecting" rows={3} />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" disabled={busyId === payment.id} onClick={() => void review(payment, "approve")}>Approve verified transfer</Button>
                      <Button type="button" variant="secondary" disabled={busyId === payment.id || !(reasons[payment.id] || "").trim()} onClick={() => void review(payment, "reject")}>Reject and release slot</Button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
            {payment.provider === "payhere" && payment.status === "review_required" ? (
              <div className="mt-5 grid gap-3 rounded-[20px] border border-amber-300/20 p-4">
                <p className="text-sm text-amber-100">Verify the payment in the PayHere merchant portal. Accept only if capacity or stock is still available. Otherwise issue the refund externally first, then record its reference here.</p>
                <Textarea value={reasons[payment.id] || ""} onChange={(event) => setReasons((current) => ({ ...current, [payment.id]: event.target.value }))} placeholder="Required reconciliation note" rows={3} />
                <Input value={refundReferences[payment.id] || ""} onChange={(event) => setRefundReferences((current) => ({ ...current, [payment.id]: event.target.value }))} placeholder="PayHere refund reference (required for refund)" />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={busyId === payment.id || !(reasons[payment.id] || "").trim()} onClick={() => void reconcilePayHere(payment, "accept")}>Accept verified payment</Button>
                  <Button type="button" variant="secondary" disabled={busyId === payment.id || !(reasons[payment.id] || "").trim() || !(refundReferences[payment.id] || "").trim()} onClick={() => void reconcilePayHere(payment, "mark_refunded")}>Record completed refund</Button>
                </div>
              </div>
            ) : null}
          </Card>
        ))}
        {payments.length === 0 ? <Card className="p-6 text-sm text-slate-400">No payments match these filters.</Card> : null}
      </div>
      <div className="mt-5 flex items-center justify-between text-sm text-slate-400">
        <span>{pagination.total} transactions · page {pagination.page} of {pagination.totalPages}</span>
        <div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button variant="secondary" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button></div>
      </div>
    </AdminShell>
  );
}
