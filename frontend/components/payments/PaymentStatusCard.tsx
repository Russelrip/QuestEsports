"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchJson } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button, buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCartStore } from "@/hooks/useCartStore";

type PaymentStatus = {
  orderId: string;
  status: "created" | "pending" | "paid" | "cancelled" | "failed" | "charged_back" | "expired" | "review_required" | "refunded";
  amount: number;
  currency: string;
  purpose: "tournament_registration" | "merchandise_order";
  statusMessage?: string | null;
  provider: string;
  bankTransfer?: {
    reference: string;
    assignedSlotNumber: number;
    amount: number;
    currency: string;
    expiresAt: string;
    proofSubmitted: boolean;
    bankAccount: {
      bankName: string;
      branch?: string | null;
      accountName: string;
      accountNumber: string;
    };
  } | null;
};

export default function PaymentStatusCard({ orderId, returnHref = "/profile", publicToken, clearCartOnPaid = false }: { orderId: string; returnHref?: string; publicToken?: string; clearCartOnPaid?: boolean }) {
  const [payment, setPayment] = useState<PaymentStatus | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [proof, setProof] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState<"account" | "reference" | null>(null);
  const attempts = useRef(0);
  const clearCart = useCartStore((state) => state.clear);

  const loadStatus = useCallback(async () => {
    setRefreshing(true);
    const query = publicToken ? `?token=${encodeURIComponent(publicToken)}` : "";
    try {
      const { response, data } = await apiFetchJson<{ payment?: PaymentStatus; message?: string }>(`/api/payments/${encodeURIComponent(orderId)}${query}`);
      if (!response.ok || !data.payment) throw new Error(data.message || "Payment status could not be loaded.");
      setPayment(data.payment);
      setError("");
      return data.payment;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Payment status could not be loaded.");
      return null;
    } finally {
      setRefreshing(false);
    }
  }, [orderId, publicToken]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(poll, 10_000);
        return;
      }
      const nextPayment = await loadStatus();
      if (cancelled) return;
      attempts.current += 1;
      if (nextPayment && ["created", "pending"].includes(nextPayment.status) && attempts.current < 40) {
        timer = setTimeout(poll, Math.min(2500 + attempts.current * 500, 10_000));
      } else if (!nextPayment && attempts.current < 8) {
        timer = setTimeout(poll, Math.min(2500 * attempts.current, 15_000));
      }
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [loadStatus]);

  const terminalSuccess = payment?.status === "paid";
  const isBankTransfer = payment?.provider === "bank_transfer"
    ? payment.bankTransfer || null
    : null;
  const statusTitle = terminalSuccess
    ? "Payment confirmed"
    : isBankTransfer?.proofSubmitted
      ? "Receipt submitted"
      : isBankTransfer
        ? "Slot reserved"
        : payment
          ? payment.status.replace(/_/g, " ")
          : "Checking payment…";

  const copyValue = async (kind: "account" | "reference", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(
        () => setCopied((current) => current === kind ? null : current),
        1800
      );
    } catch {
      setError("Copy was unavailable. Press and hold the value to copy it.");
    }
  };

  const uploadProof = async () => {
    if (!proof || !payment) return;
    setUploading(true);
    setError("");
    const body = new FormData();
    body.append("proof", proof);
    try {
      const { response, data } = await apiFetchJson<{ message?: string }>(
        `/api/payments/${encodeURIComponent(payment.orderId)}/bank-transfer-proof`,
        { method: "POST", body }
      );
      if (!response.ok) throw new Error(data.message || "Payment proof could not be uploaded.");
      setProof(null);
      await loadStatus();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Payment proof could not be uploaded.");
    } finally {
      setUploading(false);
    }
  };
  useEffect(() => {
    if (terminalSuccess && clearCartOnPaid) clearCart();
  }, [clearCart, clearCartOnPaid, terminalSuccess]);
  return (
    <Card className="mx-auto max-w-2xl p-8 text-center sm:p-10">
      <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Payment Status</p>
      <h2 className="mt-4 text-4xl capitalize text-white">{statusTitle}</h2>
      {payment ? <p className="mt-4 text-slate-300">{payment.currency} {payment.amount.toFixed(2)} · Order {payment.orderId}</p> : null}
      {isBankTransfer && !terminalSuccess ? (
        <div className="mt-7 grid gap-5 text-left">
          <div className="rounded-[22px] border border-cyan-300/20 bg-cyan-300/5 p-5">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Assigned slot #{isBankTransfer.assignedSlotNumber}</p>
            <dl className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
              <div><dt className="text-slate-500">Bank</dt><dd>{isBankTransfer.bankAccount.bankName}</dd></div>
              <div><dt className="text-slate-500">Branch</dt><dd>{isBankTransfer.bankAccount.branch || "—"}</dd></div>
              <div><dt className="text-slate-500">Account name</dt><dd>{isBankTransfer.bankAccount.accountName}</dd></div>
              <div><dt className="text-slate-500">Account number</dt><dd className="break-all font-semibold text-white">{isBankTransfer.bankAccount.accountNumber}</dd><button type="button" className="mt-1 text-xs text-cyan-200 underline" onClick={() => void copyValue("account", isBankTransfer.bankAccount.accountNumber)}>{copied === "account" ? "Copied" : "Copy account number"}</button></div>
              <div><dt className="text-slate-500">Exact amount</dt><dd>{isBankTransfer.currency} {isBankTransfer.amount.toFixed(2)}</dd></div>
              <div><dt className="text-slate-500">Transfer reference</dt><dd className="break-all text-lg font-semibold tracking-wider text-white">{isBankTransfer.reference}</dd><button type="button" className="mt-1 text-xs text-cyan-200 underline" onClick={() => void copyValue("reference", isBankTransfer.reference)}>{copied === "reference" ? "Copied" : "Copy reference"}</button></div>
            </dl>
            <p className="mt-4 text-xs leading-6 text-amber-100">Transfer the exact amount and include the reference. Never upload or share a password, PIN, OTP, card number, or banking login.</p>
            <p className="mt-2 text-xs text-slate-400">Upload deadline: {new Date(isBankTransfer.expiresAt).toLocaleString()}</p>
          </div>
          {payment && ["created", "pending", "review_required"].includes(payment.status) ? (
            <div className="grid gap-3 rounded-[22px] border border-white/10 p-5">
              <div>
                <h3 className="text-lg text-white">{isBankTransfer.proofSubmitted ? "Replace payment proof" : "Upload payment proof"}</h3>
                <p className="mt-1 text-xs leading-6 text-slate-400">Upload a screenshot of your bank slip as a JPEG, PNG, or WebP image up to 5 MB. Uploading proof does not automatically confirm payment.</p>
              </div>
              <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setProof(event.target.files?.[0] || null)} />
              <Button type="button" disabled={!proof || uploading} onClick={() => void uploadProof()}>{uploading ? "Uploading…" : isBankTransfer.proofSubmitted ? "Replace proof" : "Submit proof"}</Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="mt-4 text-sm leading-7 text-slate-400">
        {terminalSuccess
          ? isBankTransfer
            ? "Quest E-sports verified the transfer against the bank account and confirmed your registration."
            : "The verified PayHere notification has been saved and your record is confirmed."
          : isBankTransfer
            ? payment?.statusMessage || "Complete the bank transfer and upload your receipt before the reservation expires."
            : payment?.status === "created" || payment?.status === "pending"
              ? "Waiting for PayHere to notify the server. This page updates automatically."
              : payment?.statusMessage || "Do not retry until the final status appears."}
      </p>
      {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      <div className="mt-7 flex flex-wrap justify-center gap-3"><Link href={returnHref} className={buttonClassName({ variant: "secondary" })}>{terminalSuccess ? "Continue" : "Return"}</Link>{payment?.purpose === "tournament_registration" ? <Link href="/profile" className={buttonClassName({ variant: "ghost" })}>My registrations</Link> : null}{!terminalSuccess ? <button type="button" disabled={refreshing} onClick={() => void loadStatus()} className={buttonClassName({ variant: "ghost" })}>{refreshing ? "Refreshing…" : "Refresh status"}</button> : null}</div>
    </Card>
  );
}
