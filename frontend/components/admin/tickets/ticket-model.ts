import { isoToSriLankaDateTimeLocal } from "@/lib/date-time";

type TicketEventStatus =
  | "draft"
  | "on_sale"
  | "sales_paused"
  | "sales_closed"
  | "completed"
  | "cancelled";
export type TicketEvent = {
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
  status: TicketEventStatus;
  capacity: number;
  availableTickets: number;
  maxTicketsPerOrder: number;
  currency: string;
  singlePrice: number;
  pairPrice: number;
  paymentMethods: Array<"payhere" | "bank_transfer" | "cash">;
  bankTransferReviewMinutes: number;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  stats: {
    orders: Record<string, number>;
    tickets: Record<string, number>;
    sold: number;
    checkedIn: number;
    revenue: number;
    reserved: number;
  };
};
export type TicketSummary = {
  id: string;
  ticketNumber: string;
  sequence: number;
  status: string;
  checkedInAt?: string | null;
  checkedInBy?: string | null;
  buyerName: string;
  email: string;
  phone: string;
  orderStatus: string;
};
export type TicketOrderSummary = {
  id: string;
  status: string;
  buyerName: string;
  email: string;
  phone: string;
  quantity: number;
  total: number;
  currency: string;
  paymentStatus: string;
  paymentOrderId?: string | null;
  createdAt: string;
  tickets: Array<Pick<TicketSummary, "id" | "ticketNumber" | "status">>;
};
export type ScanResult = {
  result:
    | "accepted"
    | "already_used"
    | "invalid_code"
    | "invalid_status"
    | "wrong_event";
  accepted: boolean;
  message: string;
  ticket?: {
    ticketNumber: string;
    status: string;
    checkedInAt?: string | null;
    buyerName?: string | null;
    eventTitle?: string | null;
  } | null;
};
export type EventForm = {
  seriesId: string;
  title: string;
  slug: string;
  description: string;
  venue: string;
  startsAt: string;
  salesStartAt: string;
  salesEndAt: string;
  status: TicketEventStatus;
  capacity: string;
  maxTicketsPerOrder: string;
  currency: string;
  singlePrice: string;
  pairPrice: string;
  paymentMethods: Array<"payhere" | "bank_transfer" | "cash">;
  bankTransferReviewMinutes: string;
  bankName: string;
  bankBranch: string;
  bankAccountName: string;
  bankAccountNumber: string;
};
export type Tab = "overview" | "orders" | "tickets" | "check-in" | "reports";

export const blankForm: EventForm = {
  seriesId: "",
  title: "",
  slug: "",
  description: "",
  venue: "",
  startsAt: "",
  salesStartAt: "",
  salesEndAt: "",
  status: "draft",
  capacity: "100",
  maxTicketsPerOrder: "10",
  currency: "LKR",
  singlePrice: "500",
  pairPrice: "800",
  paymentMethods: ["payhere"],
  bankTransferReviewMinutes: "1440",
  bankName: "",
  bankBranch: "",
  bankAccountName: "",
  bankAccountNumber: "",
};

export const eventToForm = (event: TicketEvent): EventForm => ({
  seriesId: event.seriesId || "",
  title: event.title,
  slug: event.slug,
  description: event.description,
  venue: event.venue,
  startsAt: isoToSriLankaDateTimeLocal(event.startsAt),
  salesStartAt: isoToSriLankaDateTimeLocal(event.salesStartAt),
  salesEndAt: isoToSriLankaDateTimeLocal(event.salesEndAt),
  status: event.status,
  capacity: String(event.capacity),
  maxTicketsPerOrder: String(event.maxTicketsPerOrder),
  currency: event.currency,
  singlePrice: String(event.singlePrice),
  pairPrice: String(event.pairPrice),
  paymentMethods: event.paymentMethods,
  bankTransferReviewMinutes: String(event.bankTransferReviewMinutes),
  bankName: event.bankName || "",
  bankBranch: event.bankBranch || "",
  bankAccountName: event.bankAccountName || "",
  bankAccountNumber: event.bankAccountNumber || "",
});

export const statusTone = (value: string) =>
  ["paid", "valid", "accepted", "on_sale"].includes(value)
    ? "text-emerald-300"
    : [
          "cancelled",
          "refunded",
          "invalid_code",
          "invalid_status",
          "wrong_event",
        ].includes(value)
      ? "text-rose-300"
      : "text-amber-300";
