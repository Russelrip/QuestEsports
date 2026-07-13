"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchJson } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { buttonClassName } from "@/components/ui/button";
import { useCartStore } from "@/hooks/useCartStore";

type PaymentStatus = {
  orderId: string;
  status: "created" | "pending" | "paid" | "cancelled" | "failed" | "charged_back" | "expired" | "review_required";
  amount: number;
  currency: string;
  statusMessage?: string | null;
};

export default function PaymentStatusCard({ orderId, returnHref = "/profile", publicToken, clearCartOnPaid = false }: { orderId: string; returnHref?: string; publicToken?: string; clearCartOnPaid?: boolean }) {
  const [payment, setPayment] = useState<PaymentStatus | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
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
  useEffect(() => {
    if (terminalSuccess && clearCartOnPaid) clearCart();
  }, [clearCart, clearCartOnPaid, terminalSuccess]);
  return (
    <Card className="mx-auto max-w-2xl p-8 text-center sm:p-10">
      <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Payment Status</p>
      <h2 className="mt-4 text-4xl text-white">{terminalSuccess ? "Payment confirmed" : payment ? payment.status.replace(/_/g, " ") : "Checking payment…"}</h2>
      {payment ? <p className="mt-4 text-slate-300">{payment.currency} {payment.amount.toFixed(2)} · Order {payment.orderId}</p> : null}
      <p className="mt-4 text-sm leading-7 text-slate-400">{terminalSuccess ? "The verified PayHere notification has been saved and your record is confirmed." : payment?.status === "created" || payment?.status === "pending" ? "Waiting for PayHere to notify the server. This page updates automatically." : payment?.statusMessage || error || "Do not retry until the final status appears."}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3"><Link href={returnHref} className={buttonClassName({ variant: "secondary" })}>{terminalSuccess ? "Continue" : "Return"}</Link>{!terminalSuccess ? <button type="button" disabled={refreshing} onClick={() => void loadStatus()} className={buttonClassName({ variant: "ghost" })}>{refreshing ? "Refreshing…" : "Refresh status"}</button> : null}</div>
    </Card>
  );
}
