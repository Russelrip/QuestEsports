"use client";

import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatAdminCompactDateTime } from "@/lib/admin";
import { type TicketEvent, statusTone } from "./ticket-model";
import { Metric } from "./ticket-ui";

export function EventGrid({
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
        title="No entrance fees"
        description="Add an entrance fee to a LAN event when paid venue access is required."
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
              <p className="mt-1 text-sm font-medium text-purple-200">
                {event.series?.title || "LAN event not linked"}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {event.venue} · {formatAdminCompactDateTime(event.startsAt)}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onSelect(event.id)}
              >
                Open
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { window.location.href = `/admin/expenses?targetType=event&targetId=${event.id}`; }}
              >
                Expenses
              </Button>
            </div>
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
