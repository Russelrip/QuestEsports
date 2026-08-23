import Link from "next/link";
import EventCard from "@/components/tournaments/event/EventCard";
import { buttonClassName } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { fetchPublicEvents, getFeaturedEvents, type EventSeries } from "@/lib/tournaments";

export default async function FeaturedEvents({ limit = 3 }: { limit?: number }) {
  let events: EventSeries[] = [];

  try {
    events = await fetchPublicEvents();
  } catch (error) {
    console.error("Unable to load featured events:", error);
  }

  const featuredEvents = getFeaturedEvents(events, limit);
  // An event banner is a bonus row, not a fixture: with nothing to show the home
  // page keeps its existing rhythm instead of gaining an empty section.
  if (featuredEvents.length === 0) return null;

  return (
    <Section>
      <div className="mb-8 flex flex-col items-center gap-4 text-center sm:flex-row sm:items-end sm:justify-between sm:text-left">
        <div className="max-w-3xl">
          <h2 className="text-3xl text-white sm:text-4xl">Events</h2>
          <p className="mt-3 text-sm text-slate-400">One banner, several games. Each event carries its own lineup and registration windows.</p>
        </div>
        <Link href="/events" className={`${buttonClassName({ variant: "secondary" })} hidden sm:inline-flex`}>
          View all
        </Link>
      </div>

      <div className="mx-auto grid max-w-[76rem] gap-5 lg:grid-cols-3">
        {featuredEvents.map((event, index) => <EventCard key={event.id} event={event} eager={index === 0} />)}
      </div>
    </Section>
  );
}
