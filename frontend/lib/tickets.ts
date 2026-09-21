import { fetchApiJson } from "@/lib/api";
import { normalizeSafeRedirectPath } from "@/lib/safe-redirect";

export type TicketedEvent = {
  id: string;
  seriesId: string | null;
  series: { id: string; slug: string; title: string } | null;
  slug: string;
  title: string;
  description: string;
  venue: string;
  startsAt: string;
  salesStartAt: string;
  salesEndAt: string;
  status:
    | "draft"
    | "on_sale"
    | "sales_paused"
    | "sales_closed"
    | "completed"
    | "cancelled";
  capacity: number;
  availableTickets: number;
  maxTicketsPerOrder: number;
  currency: string;
  singlePrice: number;
  pairPrice: number;
  paymentMethods: Array<"payhere" | "bank_transfer" | "cash">;
  salesActive: boolean;
};

export type TicketQuote = {
  quantity: number;
  pairCount: number;
  singleCount: number;
  singlePrice: number;
  pairPrice: number;
  total: number;
  currency: string;
};

type IssuedTicket = {
  id: string;
  ticketNumber: string;
  sequence: number;
  status: string;
  checkedInAt?: string | null;
  checkedInBy?: string | null;
  qrPayload?: string;
};

export type TicketOrder = {
  id: string;
  status: string;
  quantity: number;
  pairCount: number;
  singleCount: number;
  pairPrice: number;
  singlePrice: number;
  currency: string;
  total: number;
  createdAt: string;
  expiresAt: string;
  paymentOrderId: string | null;
  paymentStatus: string;
  buyer: { firstName: string; lastName: string; email: string };
  event: TicketedEvent;
  tickets: IssuedTicket[];
};

export async function fetchTicketedEvents() {
  const data = await fetchApiJson<{ events: TicketedEvent[] }>(
    "/api/ticket-events",
    { next: { revalidate: 60 } },
    "Could not load ticketed events.",
  );
  return data.events;
}

export async function fetchTicketedEvent(slug: string) {
  const data = await fetchApiJson<{ event: TicketedEvent }>(
    `/api/ticket-events/${encodeURIComponent(slug)}`,
    { cache: "no-store" },
    "Ticketed event not found.",
  );
  return data.event;
}

export async function fetchTicketOrder(publicToken: string) {
  const data = await fetchApiJson<{ order: TicketOrder }>(
    "/api/ticket-orders/status",
    {
      cache: "no-store",
      headers: { "X-Ticket-Order-Token": publicToken },
    },
    "Ticket order not found.",
  );
  return data.order;
}

// A checkout that does not go to PayHere sends the buyer to the order page. The
// server supplies that path, so it is checked rather than trusted: anything that
// is not this site's own order page is refused instead of navigated to.
const TICKET_ORDER_PATHNAME = "/tickets/order";

export function safeTicketOrderPath(value: string | null | undefined): string | null {
  const path = normalizeSafeRedirectPath(value);
  if (!path) return null;
  return path.split(/[?#]/, 1)[0] === TICKET_ORDER_PATHNAME ? path : null;
}
