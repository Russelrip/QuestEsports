"use client";

import { useEffect, useState } from "react";
import PaymentStatusCard from "@/components/payments/PaymentStatusCard";
import { fetchOrder, type MerchandiseOrder } from "@/lib/shop";

const ORDER_TOKEN_PATTERN = /^[a-f0-9]{48}$/i;

export default function ShopOrderStatus() {
  const [order, setOrder] = useState<MerchandiseOrder | null>(null);
  const [publicToken, setPublicToken] = useState("");
  const [checkoutCancelled, setCheckoutCancelled] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "invalid" | "failed">("loading");

  useEffect(() => {
    let active = true;
    const loadOrder = async () => {
      // Yield once so state changes are the result of the asynchronous location/API
      // synchronization, rather than synchronous effect initialization.
      await Promise.resolve();
      if (!active) return;
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const token = String(fragment.get("token") || "").trim();
      setCheckoutCancelled(new URLSearchParams(window.location.search).get("cancelled") === "1");

      if (!ORDER_TOKEN_PATTERN.test(token)) {
        setStatus("invalid");
        return;
      }

      setPublicToken(token);
      try {
        const nextOrder = await fetchOrder(token);
        if (!active) return;
        setOrder(nextOrder);
        setStatus("ready");
      } catch {
        if (active) setStatus("failed");
      }
    };
    void loadOrder();

    return () => {
      active = false;
    };
  }, []);

  if (status === "loading") {
    return <p className="text-center text-slate-300">Loading order status&hellip;</p>;
  }
  if (status === "invalid" || status === "failed" || !order) {
    return (
      <div className="mx-auto max-w-2xl rounded-[24px] border border-rose-300/20 bg-rose-400/8 p-6 text-center">
        <h2 className="text-2xl text-white">Order link unavailable</h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          This private order link is missing, invalid, or no longer available. Open the link from your profile or contact support.
        </p>
      </div>
    );
  }

  return (
    <>
      {order.paymentOrderId ? (
        <PaymentStatusCard
          orderId={order.paymentOrderId}
          publicToken={publicToken}
          returnHref={checkoutCancelled ? "/shop/cart" : "/shop"}
          clearCartOnPaid
          checkoutCancelled={checkoutCancelled}
        />
      ) : (
        <p className="text-white">Payment record is not available.</p>
      )}

      <div className="mx-auto mt-6 max-w-2xl rounded-[24px] border border-white/10 bg-[#0d0c13] p-6">
        <h3 className="text-xl text-white">Order summary</h3>
        {order.items.map((item) => (
          <div
            key={item.id}
            className="mt-3 flex justify-between text-sm text-slate-300"
          >
            <span>
              {item.productName} &middot; {item.variantName} &times; {item.quantity}
            </span>
            <span>
              {order.currency} {item.lineTotal.toFixed(2)}
            </span>
          </div>
        ))}
        <div className="mt-4 border-t border-white/10 pt-4 text-right font-semibold text-white">
          Total {order.currency} {order.total.toFixed(2)}
        </div>
      </div>
    </>
  );
}
