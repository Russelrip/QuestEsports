import Link from "next/link";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { buttonClassName } from "@/components/ui/button";
import type { TicketedEvent } from "@/lib/tickets";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-LK", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Colombo",
  }).format(new Date(value));

export default function TicketEventsList({
  events,
}: {
  events: TicketedEvent[];
}) {
  if (!events.length) {
    return (
      <EmptyState
        title="No tickets on sale"
        description="Upcoming entrance tickets will appear here when sales open."
      />
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {events.map((event) => (
        <Card key={event.id} className="flex flex-col p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-purple-200">
            Entrance tickets
          </p>
          <h2 className="mt-3 text-3xl text-white">{event.title}</h2>
          <p className="mt-3 line-clamp-3 text-sm leading-7 text-slate-400">
            {event.description}
          </p>
          <dl className="mt-6 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">
                When
              </dt>
              <dd className="mt-1">{formatDate(event.startsAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">
                Where
              </dt>
              <dd className="mt-1">{event.venue}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">
                Singles
              </dt>
              <dd className="mt-1">
                {event.currency} {event.singlePrice.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-slate-500">
                Pairs
              </dt>
              <dd className="mt-1">
                {event.currency} {event.pairPrice.toFixed(2)}
              </dd>
            </div>
          </dl>
          <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
            <p className="text-sm text-slate-400">
              <span className="font-semibold text-white">
                {event.availableTickets}
              </span>{" "}
              remaining
            </p>
            <Link
              href={`/tickets/${event.slug}`}
              className={buttonClassName({})}
            >
              {event.salesActive ? "Buy tickets" : "View event"}
            </Link>
          </div>
        </Card>
      ))}
    </div>
  );
}
