import PageLayout from "@/components/PageLayout";
import EventCard from "@/components/tournaments/event/EventCard";
import EmptyState from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { fetchPublicEvents } from "@/lib/tournaments";
import type { EventSeries } from "@/lib/tournaments";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const revalidate = 15;

export const metadata = buildPageMetadata({
  title: "Events",
  description: defaultPageDescriptions.events,
  path: "/events",
  keywords: [
    "Quest E-sports events",
    "Sri Lanka esports event",
    "multi-game tournament event",
    "upcoming gaming events",
  ],
});

export default async function EventsPage() {
  let events: EventSeries[] = [];
  let loadError = "";
  try {
    events = (await fetchPublicEvents()).filter((event) => event.tournaments.length > 0);
  } catch {
    loadError = "Events are temporarily unavailable. Please try again shortly.";
  }

  return (
    <PageLayout title="Events" description={defaultPageDescriptions.events}>
      <Section className="pt-6">
        {events.length ? (
          <div className="grid gap-5 md:grid-cols-2">
            {events.map((event, index) => <EventCard key={event.id} event={event} preload={index === 0} eager={index < 4} />)}
          </div>
        ) : (
          <EmptyState
            title={loadError ? "Events unavailable" : "No events announced yet"}
            description={loadError || "Quest events bring several games under one banner. Check the tournaments page for what is running right now."}
          />
        )}
      </Section>
    </PageLayout>
  );
}
