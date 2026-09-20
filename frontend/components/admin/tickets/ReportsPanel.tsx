"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { downloadAdminFile } from "@/lib/admin";
import { type TicketEvent } from "./ticket-model";
import { Metric } from "./ticket-ui";

export function ReportsPanel({ event }: { event: TicketEvent }) {
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
