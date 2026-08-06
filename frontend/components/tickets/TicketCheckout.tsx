"use client";

import { FormEvent, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { apiFetch } from "@/lib/auth";
import { readApiResponse } from "@/lib/api";
import { submitPayHereCheckout, type PayHereCheckout } from "@/lib/payments";
import type { TicketedEvent, TicketQuote } from "@/lib/tickets";

export default function TicketCheckout({ event }: { event: TicketedEvent }) {
  const [quantity, setQuantity] = useState(Math.min(1, event.availableTickets));
  const [quote, setQuote] = useState<TicketQuote | null>(null);
  const [buyer, setBuyer] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!event.salesActive || quantity < 1) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const response = await apiFetch(
          `/api/ticket-events/${encodeURIComponent(event.slug)}/quote`,
          {
            method: "POST",
            json: { quantity },
          },
        );
        const data = await readApiResponse<{ quote?: TicketQuote }>(
          response,
          "Ticket total could not be verified.",
        );
        if (!response.ok || !data.quote)
          throw new Error(
            data.message || "Ticket total could not be verified.",
          );
        if (active) {
          setQuote(data.quote);
          setError("");
        }
      } catch (nextError) {
        if (active) {
          setQuote(null);
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Ticket total could not be verified.",
          );
        }
      } finally {
        if (active) setQuoteLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [event.salesActive, event.slug, quantity]);

  const submit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (!quote) return;
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(
        `/api/ticket-events/${encodeURIComponent(event.slug)}/orders`,
        {
          method: "POST",
          json: {
            ...buyer,
            quantity,
            expectedTotal: quote.total,
            expectedCurrency: quote.currency,
          },
        },
      );
      const data = await readApiResponse<{ checkout?: PayHereCheckout }>(
        response,
        "Ticket checkout could not be started.",
      );
      if (!response.ok || !data.checkout)
        throw new Error(
          data.message || "Ticket checkout could not be started.",
        );
      submitPayHereCheckout(data.checkout);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Ticket checkout could not be started.",
      );
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
      <Card className="p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-purple-200">
          Bundle pricing
        </p>
        <h2 className="mt-3 text-3xl text-white">Choose your tickets</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="border border-white/10 bg-white/[0.03] p-5">
            <p className="text-sm text-slate-400">One ticket</p>
            <p className="mt-2 text-3xl text-white">
              {event.currency} {event.singlePrice.toFixed(2)}
            </p>
          </div>
          <div className="border border-purple-300/20 bg-purple-400/8 p-5">
            <p className="text-sm text-purple-100">Every pair</p>
            <p className="mt-2 text-3xl text-white">
              {event.currency} {event.pairPrice.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {event.currency} {(event.pairPrice / 2).toFixed(2)} each
            </p>
          </div>
        </div>
        <FormField label="Quantity" required className="mt-6">
          <Input
            type="number"
            min={1}
            max={Math.min(event.maxTicketsPerOrder, event.availableTickets)}
            value={quantity}
            onChange={(input) =>
              setQuantity(Math.max(1, Number(input.target.value) || 1))
            }
          />
        </FormField>
        <div className="mt-6 border-t border-white/10 pt-5">
          {quoteLoading ? (
            <p className="text-sm text-slate-400">Verifying price…</p>
          ) : quote ? (
            <>
              <p className="text-sm text-slate-400">
                {quote.pairCount
                  ? `${quote.pairCount} pair${quote.pairCount === 1 ? "" : "s"}`
                  : ""}
                {quote.pairCount && quote.singleCount ? " + " : ""}
                {quote.singleCount ? "1 single" : ""}
              </p>
              <p className="mt-2 text-4xl text-white">
                {quote.currency} {quote.total.toFixed(2)}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Every attendee receives a separate one-use QR ticket.
              </p>
            </>
          ) : (
            <p className="text-sm text-rose-300">Price unavailable</p>
          )}
        </div>
      </Card>

      <Card className="p-6 sm:p-8">
        <h2 className="text-3xl text-white">Buyer and payment</h2>
        {!event.salesActive ? (
          <p className="mt-4 border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">
            Ticket sales are not currently open.
          </p>
        ) : null}
        <form className="mt-6 grid gap-5" onSubmit={submit}>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="First name" required>
              <Input
                required
                value={buyer.firstName}
                onChange={(input) =>
                  setBuyer((current) => ({
                    ...current,
                    firstName: input.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="Last name" required>
              <Input
                required
                value={buyer.lastName}
                onChange={(input) =>
                  setBuyer((current) => ({
                    ...current,
                    lastName: input.target.value,
                  }))
                }
              />
            </FormField>
          </div>
          <FormField
            label="Email"
            hint="Your private QR ticket link will be sent here."
            required
          >
            <Input
              type="email"
              required
              value={buyer.email}
              onChange={(input) =>
                setBuyer((current) => ({
                  ...current,
                  email: input.target.value,
                }))
              }
            />
          </FormField>
          <FormField label="Phone" required>
            <Input
              required
              value={buyer.phone}
              onChange={(input) =>
                setBuyer((current) => ({
                  ...current,
                  phone: input.target.value,
                }))
              }
            />
          </FormField>
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          <Button
            type="submit"
            disabled={!event.salesActive || !quote || quoteLoading || loading}
          >
            {loading ? "Starting secure payment…" : "Proceed to secure payment"}
          </Button>
          <p className="text-xs leading-6 text-slate-500">
            Prices and capacity are verified by the server. Tickets activate
            only after PayHere confirms payment.
          </p>
        </form>
      </Card>
    </div>
  );
}
