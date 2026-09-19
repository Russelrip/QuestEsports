"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatAdminCompactDateTime } from "@/lib/admin";
import { type TicketEvent, type Tab } from "./ticket-model";
import { Overview } from "./Overview";
import { OrdersPanel } from "./OrdersPanel";
import { TicketsPanel } from "./TicketsPanel";
import { CheckInPanel } from "./CheckInPanel";
import { ReportsPanel } from "./ReportsPanel";

export function EventWorkspace({
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
