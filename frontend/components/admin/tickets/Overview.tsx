"use client";

import { Card } from "@/components/ui/card";
import { formatAdminCompactDateTime } from "@/lib/admin";
import { type TicketEvent } from "./ticket-model";
import { MetricCard, Info } from "./ticket-ui";

export function Overview({ event }: { event: TicketEvent }) {
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
