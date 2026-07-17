"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useCartStore } from "@/hooks/useCartStore";
import { apiFetch, apiFetchJson } from "@/lib/auth";
import { readApiResponse } from "@/lib/api";
import { PayHereCheckout, submitPayHereCheckout } from "@/lib/payments";
import type { CommerceCapabilities, MerchandiseQuote } from "@/lib/shop";

const cartPayload = (items: ReturnType<typeof useCartStore.getState>["items"]) =>
  items.map((item) => ({ variantId: item.variantId, quantity: item.quantity }));

export default function CartCheckout() {
  const { user } = useAuth();
  const { items, updateQuantity, removeItem } = useCartStore();
  const [customer, setCustomer] = useState({ firstName: "", lastName: "", email: "", phone: "", address: "", city: "" });
  const [loading, setLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [error, setError] = useState("");
  const [quote, setQuote] = useState<MerchandiseQuote | null>(null);
  const [capabilities, setCapabilities] = useState<CommerceCapabilities | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (user) {
      setCustomer((current) => ({
        ...current,
        firstName: current.firstName || user.firstName,
        lastName: current.lastName || user.lastName,
        email: current.email || user.email,
        phone: current.phone || user.phone || "",
      }));
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { response, data } = await apiFetchJson<{ capabilities?: CommerceCapabilities; message?: string }>("/api/commerce/capabilities");
        if (cancelled) return;
        if (response.ok && data.capabilities) {
          setCapabilities(data.capabilities);
        } else {
          setError(data.message || "Checkout availability could not be verified. Please retry.");
        }
      } catch {
        if (!cancelled) setError("Checkout availability could not be verified. Please retry.");
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [retryKey]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (items.length === 0) {
        setQuote(null);
        setQuoteLoading(false);
        return;
      }
      setQuoteLoading(true);
      try {
        const { response, data } = await apiFetchJson<{ quote?: MerchandiseQuote; message?: string }>("/api/orders/quote", {
          method: "POST",
          json: { items: cartPayload(items) },
        });
        if (!cancelled) {
          if (response.ok && data.quote) {
            setQuote(data.quote);
            setError("");
          } else {
            setQuote(null);
            setError(data.message || "The current cart total could not be verified.");
          }
        }
      } catch {
        if (!cancelled) {
          setQuote(null);
          setError("The current cart total could not be verified. Check your connection and retry.");
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [items, retryKey]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (!quote) throw new Error("Wait for the verified cart total before continuing.");
      if (!capabilities?.shopCheckoutAvailable) throw new Error("Online payment is not available yet.");
      const response = await apiFetch("/api/orders", {
        method: "POST",
        json: {
          ...customer,
          expectedTotal: quote.total,
          expectedCurrency: quote.currency,
          items: cartPayload(items),
        },
      });
      const data = await readApiResponse<{
        success?: boolean;
        message?: string;
        checkout?: PayHereCheckout;
      }>(response, "Checkout could not be started.");
      if (!response.ok || !data.checkout) throw new Error(data.message || "Checkout could not be started.");
      submitPayHereCheckout(data.checkout);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Checkout could not be started.");
      setLoading(false);
    }
  };

  if (items.length === 0) {
    return <EmptyState title="Your cart is empty" description="Choose a merchandise variant before checkout."><div className="mb-5"><Link href="/shop" className="text-cyan-200 underline">Browse products</Link></div></EmptyState>;
  }

  const checkoutUnavailable = capabilities && !capabilities.shopCheckoutAvailable;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
      <Card className="p-6 sm:p-8">
        <h2 className="text-3xl text-white">Your cart</h2>
        <div className="mt-6 grid gap-4">
          {items.map((item) => <div key={item.variantId} className="grid gap-4 rounded-[22px] border border-white/10 p-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><Link href={`/shop/${item.productSlug}`} className="font-semibold text-white hover:text-cyan-100">{item.productName}</Link><p className="text-sm text-slate-400">{item.variantName}</p></div><div className="flex items-center gap-3"><input aria-label={`Quantity for ${item.productName}`} type="number" min="1" max="20" value={item.quantity} onChange={(event) => updateQuantity(item.variantId, Number(event.target.value))} className="w-20 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white" /><button type="button" onClick={() => removeItem(item.variantId)} className="text-sm text-rose-300">Remove</button></div></div>)}
        </div>
        <div className="mt-6 grid gap-2 border-t border-white/10 pt-5 text-right">
          {quoteLoading ? <p className="text-sm text-slate-400">Verifying current prices…</p> : quote ? <><p className="text-sm text-slate-400">Subtotal: {quote.currency} {quote.subtotal.toFixed(2)}</p><p className="text-sm text-slate-400">Delivery: {quote.currency} {quote.deliveryFee.toFixed(2)}</p><p className="mt-1 text-3xl text-white">Total {quote.currency} {quote.total.toFixed(2)}</p></> : <p className="text-sm text-rose-300">Total unavailable</p>}
        </div>
      </Card>

      <Card className="p-6 sm:p-8">
        <h2 className="text-3xl text-white">Delivery and payment</h2>
        {checkoutUnavailable ? <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm leading-7 text-amber-100">Online checkout is not available yet. Your cart is saved locally, and no order or stock reservation has been created.</p> : null}
        <form className="mt-6 grid gap-5" onSubmit={submit}>
          <div className="grid gap-5 sm:grid-cols-2"><FormField label="First name" required><Input required value={customer.firstName} onChange={(event) => setCustomer((current) => ({ ...current, firstName: event.target.value }))} /></FormField><FormField label="Last name" required><Input required value={customer.lastName} onChange={(event) => setCustomer((current) => ({ ...current, lastName: event.target.value }))} /></FormField></div>
          <FormField label="Email" required><Input type="email" required value={customer.email} onChange={(event) => setCustomer((current) => ({ ...current, email: event.target.value }))} /></FormField>
          <FormField label="Phone" required><Input required value={customer.phone} onChange={(event) => setCustomer((current) => ({ ...current, phone: event.target.value }))} /></FormField>
          <FormField label="Delivery address" required><Input required value={customer.address} onChange={(event) => setCustomer((current) => ({ ...current, address: event.target.value }))} /></FormField>
          <FormField label="City" required><Input required value={customer.city} onChange={(event) => setCustomer((current) => ({ ...current, city: event.target.value }))} /></FormField>
          {error ? <div className="grid gap-3"><p className="text-sm text-rose-300">{error}</p><Button type="button" onClick={() => setRetryKey((value) => value + 1)}>Retry verification</Button></div> : null}
          <Button type="submit" disabled={loading || quoteLoading || !quote || !capabilities?.shopCheckoutAvailable}>{loading ? "Starting checkout…" : checkoutUnavailable ? "Online payment unavailable" : "Proceed to secure payment"}</Button>
          <p className="text-xs leading-6 text-slate-500">Sri Lanka delivery only. No cash on delivery. By continuing you accept the Terms, Privacy Policy, and Refund Policy.</p>
        </form>
      </Card>
    </div>
  );
}
