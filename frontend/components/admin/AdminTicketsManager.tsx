"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  adminRequest,
  downloadAdminFile,
  formatAdminCompactDateTime,
  type Pagination,
} from "@/lib/admin";
import {
  isoToSriLankaDateTimeLocal,
  sriLankaDateTimeLocalToIso,
} from "@/lib/date-time";

type TicketEventStatus =
  | "draft"
  | "on_sale"
  | "sales_paused"
  | "sales_closed"
  | "completed"
  | "cancelled";
type TicketEvent = {
  id: string;
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
  stats: {
    orders: Record<string, number>;
    tickets: Record<string, number>;
    sold: number;
    checkedIn: number;
    revenue: number;
    reserved: number;
  };
};
type TicketSummary = {
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
type TicketOrderSummary = {
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
type ScanResult = {
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
type EventForm = {
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
};
type Tab = "overview" | "orders" | "tickets" | "check-in" | "reports";

const blankForm: EventForm = {
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
};

const eventToForm = (event: TicketEvent): EventForm => ({
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
});

const statusTone = (value: string) =>
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

export default function AdminTicketsManager() {
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EventForm>(blankForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = useMemo(
    () => events.find((event) => event.id === selectedId) || null,
    [events, selectedId],
  );

  const refresh = useCallback(async () => {
    try {
      const data = await adminRequest<{ events: TicketEvent[] }>(
        "/api/admin/ticket-events",
      );
      setEvents(data.events);
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load ticketed events.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startCreate = () => {
    setForm(blankForm);
    setEditing(true);
    setSelectedId(null);
  };
  const startEdit = () => {
    if (selected) {
      setForm(eventToForm(selected));
      setEditing(true);
    }
  };
  const save = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        startsAt: sriLankaDateTimeLocalToIso(form.startsAt),
        salesStartAt: sriLankaDateTimeLocalToIso(form.salesStartAt),
        salesEndAt: sriLankaDateTimeLocalToIso(form.salesEndAt),
        capacity: Number(form.capacity),
        maxTicketsPerOrder: Number(form.maxTicketsPerOrder),
        singlePrice: Number(form.singlePrice),
        pairPrice: Number(form.pairPrice),
      };
      const data = await adminRequest<{ event: TicketEvent }>(
        selected
          ? `/api/admin/ticket-events/${selected.id}`
          : "/api/admin/ticket-events",
        {
          method: selected ? "PATCH" : "POST",
          json: payload,
        },
      );
      await refresh();
      setSelectedId(data.event.id);
      setEditing(false);
      setTab("overview");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Event could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell
      title="Ticketing"
      description="Keep every event's orders, payments, issued QR tickets, check-ins, and reports together."
      actions={
        <Button type="button" onClick={startCreate}>
          New ticketed event
        </Button>
      }
    >
      {editing ? (
        <EventEditor
          form={form}
          setForm={setForm}
          error={error}
          saving={saving}
          isEditing={Boolean(selected)}
          onSubmit={save}
          onCancel={() => setEditing(false)}
        />
      ) : selected ? (
        <EventWorkspace
          event={selected}
          tab={tab}
          setTab={setTab}
          onBack={() => {
            setSelectedId(null);
            setTab("overview");
          }}
          onEdit={startEdit}
          onRefresh={refresh}
        />
      ) : (
        <EventGrid
          events={events}
          loading={loading}
          error={error}
          onSelect={(id) => {
            setSelectedId(id);
            setTab("overview");
          }}
        />
      )}
    </AdminShell>
  );
}

function EventGrid({
  events,
  loading,
  error,
  onSelect,
}: {
  events: TicketEvent[];
  loading: boolean;
  error: string;
  onSelect: (id: string) => void;
}) {
  if (loading)
    return <Card className="p-8 text-slate-400">Loading ticketed events…</Card>;
  if (error)
    return <EmptyState title="Unable to load ticketing" description={error} />;
  if (!events.length)
    return (
      <EmptyState
        title="No ticketed events"
        description="Create the first event to start selling entrance tickets."
      />
    );
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {events.map((event) => (
        <Card key={event.id} className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p
                className={`text-xs font-semibold uppercase tracking-wider ${statusTone(event.status)}`}
              >
                {event.status.replaceAll("_", " ")}
              </p>
              <h3 className="mt-2 text-2xl text-white">{event.title}</h3>
              <p className="mt-1 text-sm text-slate-400">
                {event.venue} · {formatAdminCompactDateTime(event.startsAt)}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onSelect(event.id)}
            >
              Open
            </Button>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              label="Sold"
              value={`${event.stats.sold}/${event.capacity}`}
            />
            <Metric label="Checked in" value={event.stats.checkedIn} />
            <Metric label="Orders" value={event.stats.orders.paid || 0} />
            <Metric
              label="Revenue"
              value={`${event.currency} ${event.stats.revenue.toFixed(0)}`}
            />
          </div>
        </Card>
      ))}
    </div>
  );
}

function EventWorkspace({
  event,
  tab,
  setTab,
  onBack,
  onEdit,
  onRefresh,
}: {
  event: TicketEvent;
  tab: Tab;
  setTab: (tab: Tab) => void;
  onBack: () => void;
  onEdit: () => void;
  onRefresh: () => Promise<void>;
}) {
  const tabs: Array<[Tab, string]> = [
    ["overview", "Overview"],
    ["orders", "Orders & payments"],
    ["tickets", "Issued tickets"],
    ["check-in", "Check-in"],
    ["reports", "Reports"],
  ];
  return (
    <div className="grid gap-5">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <button
              type="button"
              className="text-sm text-purple-200 underline"
              onClick={onBack}
            >
              All ticketed events
            </button>
            <h3 className="mt-2 text-3xl text-white">{event.title}</h3>
            <p className="mt-1 text-sm text-slate-400">
              {event.venue} · {formatAdminCompactDateTime(event.startsAt)}
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={onEdit}>
            Edit event
          </Button>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-5">
          {tabs.map(([value, label]) => (
            <Button
              key={value}
              type="button"
              variant={tab === value ? "primary" : "ghost"}
              onClick={() => setTab(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </Card>
      {tab === "overview" ? <Overview event={event} /> : null}
      {tab === "orders" ? <OrdersPanel event={event} /> : null}
      {tab === "tickets" ? (
        <TicketsPanel event={event} onRefresh={onRefresh} />
      ) : null}
      {tab === "check-in" ? (
        <CheckInPanel event={event} onAccepted={onRefresh} />
      ) : null}
      {tab === "reports" ? <ReportsPanel event={event} /> : null}
    </div>
  );
}

function Overview({ event }: { event: TicketEvent }) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Tickets sold"
          value={`${event.stats.sold} / ${event.capacity}`}
          detail={`${event.availableTickets} currently available`}
        />
        <MetricCard
          label="Checked in"
          value={event.stats.checkedIn}
          detail={`${Math.max(event.stats.sold - event.stats.checkedIn, 0)} paid tickets not checked in`}
        />
        <MetricCard
          label="Paid orders"
          value={event.stats.orders.paid || 0}
          detail={`${event.stats.orders.pending_payment || 0} awaiting payment`}
        />
        <MetricCard
          label="Revenue"
          value={`${event.currency} ${event.stats.revenue.toFixed(2)}`}
          detail="Provider-confirmed ticket orders"
        />
      </div>
      <Card className="p-6">
        <h4 className="text-xl text-white">Event setup</h4>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Status" value={event.status.replaceAll("_", " ")} />
          <Info
            label="Sales window"
            value={`${formatAdminCompactDateTime(event.salesStartAt)} – ${formatAdminCompactDateTime(event.salesEndAt)}`}
          />
          <Info
            label="Maximum per order"
            value={String(event.maxTicketsPerOrder)}
          />
          <Info
            label="Single price"
            value={`${event.currency} ${event.singlePrice.toFixed(2)}`}
          />
          <Info
            label="Pair price"
            value={`${event.currency} ${event.pairPrice.toFixed(2)}`}
          />
          <Info
            label="Pricing rule"
            value="Each pair uses the pair price; an odd remaining ticket uses the single price."
          />
        </dl>
      </Card>
    </div>
  );
}

function OrdersPanel({ event }: { event: TicketEvent }) {
  const [orders, setOrders] = useState<TicketOrderSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "25",
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (status) params.set("status", status);
      const data = await adminRequest<{
        orders: TicketOrderSummary[];
        pagination: Pagination;
      }>(`/api/admin/ticket-events/${event.id}/orders?${params}`);
      setOrders(data.orders);
      setPagination(data.pagination);
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Orders could not be loaded.",
      );
    }
  }, [debouncedSearch, event.id, page, status]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="grid gap-3 border-b border-white/10 p-5 sm:grid-cols-2">
        <Input
          value={search}
          onChange={(input) => {
            setSearch(input.target.value);
            setPage(1);
          }}
          placeholder="Search buyer, email, phone, or ticket…"
        />
        <Select
          value={status}
          onChange={(input) => {
            setStatus(input.target.value);
            setPage(1);
          }}
        >
          <option value="">All order statuses</option>
          {["pending_payment", "paid", "cancelled", "expired", "refunded"].map(
            (value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ),
          )}
        </Select>
      </div>
      {error ? (
        <div className="p-5">
          <EmptyState description={error} />
        </div>
      ) : !orders.length ? (
        <div className="p-5">
          <EmptyState description="No ticket orders matched these filters." />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="p-4">Buyer</th>
                  <th className="p-4">Tickets</th>
                  <th className="p-4">Total</th>
                  <th className="p-4">Order</th>
                  <th className="p-4">Payment</th>
                  <th className="p-4">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="p-4">
                      <p className="font-semibold text-white">
                        {order.buyerName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {order.email} · {order.phone}
                      </p>
                    </td>
                    <td className="p-4 text-slate-300">{order.quantity}</td>
                    <td className="p-4 text-slate-300">
                      {order.currency} {order.total.toFixed(2)}
                    </td>
                    <td
                      className={`p-4 text-xs uppercase ${statusTone(order.status)}`}
                    >
                      {order.status.replaceAll("_", " ")}
                    </td>
                    <td
                      className={`p-4 text-xs uppercase ${statusTone(order.paymentStatus)}`}
                    >
                      {order.paymentStatus.replaceAll("_", " ")}
                    </td>
                    <td className="p-4 text-sm text-slate-400">
                      {formatAdminCompactDateTime(order.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager pagination={pagination} setPage={setPage} />
        </>
      )}
    </Card>
  );
}

function TicketsPanel({
  event,
  onRefresh,
}: {
  event: TicketEvent;
  onRefresh: () => Promise<void>;
}) {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "25",
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (status) params.set("status", status);
      const data = await adminRequest<{
        tickets: TicketSummary[];
        pagination: Pagination;
      }>(`/api/admin/ticket-events/${event.id}/tickets?${params}`);
      setTickets(data.tickets);
      setPagination(data.pagination);
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Tickets could not be loaded.",
      );
    }
  }, [debouncedSearch, event.id, page, status]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const action = async (
    path: string,
    options: { method: "POST" | "PATCH"; json?: unknown },
  ) => {
    try {
      await adminRequest(path, options);
      await Promise.all([load(), onRefresh()]);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Ticket could not be updated.",
      );
    }
  };
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="grid gap-3 border-b border-white/10 p-5 sm:grid-cols-2">
        <Input
          value={search}
          onChange={(input) => {
            setSearch(input.target.value);
            setPage(1);
          }}
          placeholder="Search ticket or buyer…"
        />
        <Select
          value={status}
          onChange={(input) => {
            setStatus(input.target.value);
            setPage(1);
          }}
        >
          <option value="">All ticket statuses</option>
          {["pending", "valid", "checked_in", "cancelled", "refunded"].map(
            (value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ),
          )}
        </Select>
      </div>
      {error ? <p className="p-5 text-sm text-rose-300">{error}</p> : null}
      {!tickets.length ? (
        <div className="p-5">
          <EmptyState description="No issued tickets matched these filters." />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="p-4">Ticket</th>
                  <th className="p-4">Buyer</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Check-in</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {tickets.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="p-4 font-mono text-sm text-white">
                      {ticket.ticketNumber}
                    </td>
                    <td className="p-4">
                      <p className="text-sm text-white">{ticket.buyerName}</p>
                      <p className="text-xs text-slate-500">
                        {ticket.email} · {ticket.phone}
                      </p>
                    </td>
                    <td
                      className={`p-4 text-xs uppercase ${statusTone(ticket.status)}`}
                    >
                      {ticket.status.replaceAll("_", " ")}
                    </td>
                    <td className="p-4 text-xs text-slate-400">
                      {ticket.checkedInAt
                        ? `${formatAdminCompactDateTime(ticket.checkedInAt)}${ticket.checkedInBy ? ` · ${ticket.checkedInBy}` : ""}`
                        : "Not checked in"}
                    </td>
                    <td className="p-4">
                      <div className="flex justify-end gap-2">
                        {ticket.status === "valid" ? (
                          <>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() =>
                                void action(
                                  `/api/admin/ticket-events/${event.id}/tickets/${ticket.id}/check-in`,
                                  { method: "POST" },
                                )
                              }
                            >
                              Check in
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() =>
                                window.confirm("Invalidate this ticket?") &&
                                void action(`/api/admin/tickets/${ticket.id}`, {
                                  method: "PATCH",
                                  json: { status: "cancelled" },
                                })
                              }
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() =>
                                window.confirm(
                                  "Replace this QR code? The old code will stop working.",
                                ) &&
                                void action(
                                  `/api/admin/tickets/${ticket.id}/reissue`,
                                  { method: "POST" },
                                )
                              }
                            >
                              Reissue
                            </Button>
                          </>
                        ) : ticket.status === "cancelled" &&
                          ticket.orderStatus === "paid" ? (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() =>
                              void action(`/api/admin/tickets/${ticket.id}`, {
                                method: "PATCH",
                                json: { status: "valid" },
                              })
                            }
                          >
                            Restore
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager pagination={pagination} setPage={setPage} />
        </>
      )}
    </Card>
  );
}

function CheckInPanel({
  event,
  onAccepted,
}: {
  event: TicketEvent;
  onAccepted: () => Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const scanningRef = useRef(false);
  const lastPayloadRef = useRef("");
  const [payload, setPayload] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");

  const submitScan = useCallback(
    async (value: string) => {
      const normalized = value.trim();
      if (!normalized || scanningRef.current) return;
      scanningRef.current = true;
      try {
        const data = await adminRequest<{ scan: ScanResult }>(
          `/api/admin/ticket-events/${event.id}/scan`,
          { method: "POST", json: { payload: normalized } },
        );
        setResult(data.scan);
        setError("");
        if (data.scan.accepted) await onAccepted();
        if (navigator.vibrate)
          navigator.vibrate(data.scan.accepted ? 120 : [100, 80, 100]);
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Ticket could not be checked.",
        );
      } finally {
        window.setTimeout(() => {
          scanningRef.current = false;
        }, 900);
      }
    },
    [event.id, onAccepted],
  );

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraOn(false);
  }, []);
  const startCamera = async () => {
    setError("");
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      if (!videoRef.current) return;
      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (scanResult) => {
          const text = scanResult?.getText();
          if (!text || text === lastPayloadRef.current) return;
          lastPayloadRef.current = text;
          window.setTimeout(() => {
            if (lastPayloadRef.current === text) lastPayloadRef.current = "";
          }, 2500);
          void submitScan(text);
        },
      );
      setCameraOn(true);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Camera scanning is unavailable. Use the Android app or paste a QR value.",
      );
      stopCamera();
    }
  };
  useEffect(() => stopCamera, [stopCamera]);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.8fr]">
      <Card className="overflow-hidden p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="text-2xl text-white">Camera scanner</h4>
            <p className="mt-1 text-sm text-slate-400">
              Scans are verified live against {event.title}.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => (cameraOn ? stopCamera() : void startCamera())}
          >
            {cameraOn ? "Stop camera" : "Start camera"}
          </Button>
        </div>
        <video
          ref={videoRef}
          muted
          playsInline
          className="mt-5 aspect-[4/3] w-full bg-black object-cover"
        />
        <div className="mt-5 grid gap-3">
          <Input
            value={payload}
            onChange={(input) => setPayload(input.target.value)}
            placeholder="Or paste the QR payload…"
          />
          <Button
            type="button"
            disabled={!payload.trim()}
            onClick={() => void submitScan(payload)}
          >
            Verify and check in
          </Button>
        </div>
        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
      </Card>
      <Card
        className={`p-6 ${result?.accepted ? "border-emerald-300/30 bg-emerald-400/5" : result ? "border-rose-300/30 bg-rose-400/5" : ""}`}
      >
        <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
          Latest scan
        </p>
        {result ? (
          <>
            <h4
              className={`mt-4 text-3xl ${result.accepted ? "text-emerald-200" : "text-rose-200"}`}
            >
              {result.accepted ? "Admit attendee" : "Do not admit"}
            </h4>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {result.message}
            </p>
            {result.ticket ? (
              <dl className="mt-6 grid gap-3">
                <Info label="Ticket" value={result.ticket.ticketNumber} />
                <Info
                  label="Buyer"
                  value={result.ticket.buyerName || "Unknown"}
                />
                <Info
                  label="Status"
                  value={result.ticket.status.replaceAll("_", " ")}
                />
                {result.ticket.checkedInAt ? (
                  <Info
                    label="First check-in"
                    value={formatAdminCompactDateTime(
                      result.ticket.checkedInAt,
                    )}
                  />
                ) : null}
              </dl>
            ) : null}
          </>
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            Start the camera and scan a Quest ticket.
          </p>
        )}
      </Card>
    </div>
  );
}

function ReportsPanel({ event }: { event: TicketEvent }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card className="p-6">
      <h4 className="text-2xl text-white">Event report</h4>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
        Export one grouped attendee file for this event, including order status,
        ticket validity, check-in time, and the staff member who checked it in.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Metric label="Sold" value={event.stats.sold} />
        <Metric label="Checked in" value={event.stats.checkedIn} />
        <Metric
          label="Revenue"
          value={`${event.currency} ${event.stats.revenue.toFixed(2)}`}
        />
      </div>
      <Button
        className="mt-6"
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void downloadAdminFile(
            `/api/admin/ticket-events/${event.id}/report`,
            `${event.slug}-ticket-report.csv`,
          ).finally(() => setBusy(false));
        }}
      >
        {busy ? "Preparing report…" : "Download CSV report"}
      </Button>
    </Card>
  );
}

function EventEditor({
  form,
  setForm,
  error,
  saving,
  isEditing,
  onSubmit,
  onCancel,
}: {
  form: EventForm;
  setForm: React.Dispatch<React.SetStateAction<EventForm>>;
  error: string;
  saving: boolean;
  isEditing: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const field = <K extends keyof EventForm>(key: K) => ({
    value: form[key],
    onChange: (
      input: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => setForm((current) => ({ ...current, [key]: input.target.value })),
  });
  return (
    <Card className="p-6 sm:p-8">
      <h3 className="text-3xl text-white">
        {isEditing ? "Edit ticketed event" : "Create ticketed event"}
      </h3>
      <p className="mt-2 text-sm text-slate-400">
        Bundle pricing is automatic: every pair uses the pair price and one odd
        remaining ticket uses the single price.
      </p>
      <form className="mt-7 grid gap-5" onSubmit={onSubmit}>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Event title" required>
            <Input required {...field("title")} />
          </FormField>
          <FormField label="URL slug" required>
            <Input required {...field("slug")} />
          </FormField>
        </div>
        <FormField label="Description" required>
          <Textarea required {...field("description")} />
        </FormField>
        <FormField label="Venue" required>
          <Input required {...field("venue")} />
        </FormField>
        <div className="grid gap-5 sm:grid-cols-3">
          <FormField label="Event date and time" required>
            <Input type="datetime-local" required {...field("startsAt")} />
          </FormField>
          <FormField label="Sales open" required>
            <Input type="datetime-local" required {...field("salesStartAt")} />
          </FormField>
          <FormField label="Sales close" required>
            <Input type="datetime-local" required {...field("salesEndAt")} />
          </FormField>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Capacity" required>
            <Input type="number" min="1" required {...field("capacity")} />
          </FormField>
          <FormField label="Maximum per order" required>
            <Input
              type="number"
              min="1"
              max="100"
              required
              {...field("maxTicketsPerOrder")}
            />
          </FormField>
          <FormField label="Currency" required>
            <Input maxLength={3} required {...field("currency")} />
          </FormField>
          <FormField label="Status" required>
            <Select {...field("status")}>
              {[
                "draft",
                "on_sale",
                "sales_paused",
                "sales_closed",
                "completed",
                "cancelled",
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Single ticket price" required>
            <Input
              type="number"
              min="0"
              step="0.01"
              required
              {...field("singlePrice")}
            />
          </FormField>
          <FormField
            label="Pair price"
            hint="For example, 800 means each pair costs 800 total."
            required
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              required
              {...field("pairPrice")}
            />
          </FormField>
        </div>
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save event"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-3xl text-white">{value}</p>
      <p className="mt-2 text-xs text-slate-400">{detail}</p>
    </Card>
  );
}
function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-white/10 bg-white/[0.02] p-4">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl text-white">{value}</p>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-200">{value}</dd>
    </div>
  );
}
function Pager({
  pagination,
  setPage,
}: {
  pagination: Pagination | null;
  setPage: React.Dispatch<React.SetStateAction<number>>;
}) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-white/10 p-4">
      <p className="text-sm text-slate-400">
        Page {pagination.page} of {pagination.totalPages}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={pagination.page <= 1}
          onClick={() => setPage((current) => current - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => setPage((current) => current + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
