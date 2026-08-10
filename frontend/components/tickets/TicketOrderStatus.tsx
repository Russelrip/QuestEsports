"use client";

import { useCallback, useEffect, useState } from "react";
import PaymentStatusCard from "@/components/payments/PaymentStatusCard";
import TicketQrCode from "@/components/tickets/TicketQrCode";
import { Card } from "@/components/ui/card";
import { fetchTicketOrder, type TicketOrder } from "@/lib/tickets";

const TOKEN_PATTERN = /^[a-f0-9]{48}$/i;

export default function TicketOrderStatus() {
  const [order, setOrder] = useState<TicketOrder | null>(null);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "invalid">(
    "loading",
  );
  const [cancelled, setCancelled] = useState(false);

  const load = useCallback(async (publicToken: string) => {
    try {
      setOrder(await fetchTicketOrder(publicToken));
      setStatus("ready");
    } catch {
      setStatus("invalid");
    }
  }, []);

  useEffect(() => {
    let active = true;
    const synchronizeLocation = async () => {
      await Promise.resolve();
      if (!active) return;
      const query = new URLSearchParams(window.location.search);
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const publicToken = String(fragment.get("token") || "").trim();
      setCancelled(query.get("cancelled") === "1");
      if (!TOKEN_PATTERN.test(publicToken)) {
        setStatus("invalid");
        return;
      }
      setToken(publicToken);
      await load(publicToken);
    };
    void synchronizeLocation();
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    if (!token || order?.status === "paid" || status !== "ready") return;
    const timer = window.setInterval(() => void load(token), 5000);
    return () => window.clearInterval(timer);
  }, [load, order?.status, status, token]);

  if (status === "loading")
    return <p className="text-center text-slate-300">Loading ticket order…</p>;
  if (status === "invalid" || !order)
    return (
      <Card className="mx-auto max-w-2xl p-8 text-center">
        <h2 className="text-2xl text-white">Ticket link unavailable</h2>
        <p className="mt-3 text-sm text-slate-400">
          Open the private link from your confirmation email or contact Quest
          support.
        </p>
      </Card>
    );

  return (
    <div className="grid gap-6">
      {order.paymentOrderId ? (
        <PaymentStatusCard
          orderId={order.paymentOrderId}
          publicToken={token}
          returnHref="/tickets"
          checkoutCancelled={cancelled}
        />
      ) : null}
      <Card className="mx-auto w-full max-w-5xl p-6 sm:p-8">
        <div className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-purple-200">
              Ticket order
            </p>
            <h2 className="mt-2 text-3xl text-white">{order.event.title}</h2>
            <p className="mt-2 text-sm text-slate-400">
              {order.event.venue} ·{" "}
              {new Date(order.event.startsAt).toLocaleString("en-LK", {
                timeZone: "Asia/Colombo",
              })}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-sm text-slate-400">
              {order.quantity} ticket{order.quantity === 1 ? "" : "s"}
            </p>
            <p className="text-2xl text-white">
              {order.currency} {order.total.toFixed(2)}
            </p>
          </div>
        </div>
        {order.status === "paid" ? (
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {order.tickets.map((ticket) => (
              <article
                key={ticket.id}
                className="border border-white/10 bg-black/20 p-4"
              >
                {ticket.qrPayload ? (
                  <TicketQrCode
                    payload={ticket.qrPayload}
                    label={ticket.ticketNumber}
                  />
                ) : null}
                <p className="mt-4 text-xs uppercase tracking-wider text-slate-500">
                  Ticket {ticket.sequence} of {order.quantity}
                </p>
                <p className="mt-1 break-all font-mono text-sm font-semibold text-white">
                  {ticket.ticketNumber}
                </p>
                <p
                  className={`mt-2 text-xs font-semibold uppercase tracking-wider ${ticket.status === "valid" ? "text-emerald-300" : ticket.status === "checked_in" ? "text-purple-200" : "text-rose-300"}`}
                >
                  {ticket.status.replaceAll("_", " ")}
                </p>
                {ticket.checkedInAt ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Checked in {new Date(ticket.checkedInAt).toLocaleString()}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-6 border border-amber-300/20 bg-amber-300/5 p-5 text-sm text-amber-100">
            QR tickets appear here after the verified payment notification
            reaches Quest.
          </p>
        )}
      </Card>
    </div>
  );
}
