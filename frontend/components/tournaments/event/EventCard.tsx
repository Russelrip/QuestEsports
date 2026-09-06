import TournamentGridCard from "@/components/tournaments/TournamentGridCard";
import { getEventCardPresentation } from "@/lib/event-utils";
import type { EventSeries } from "@/lib/tournaments";
import { formatTournamentDate } from "@/lib/utils";

export default function EventCard({ event, preload = false, eager = false }: { event: EventSeries; preload?: boolean; eager?: boolean }) {
  const presentation = getEventCardPresentation(event);
  const games = event.tournaments.length;
  return <TournamentGridCard
    href={`/tournaments/events/${event.slug}`}
    bannerUrl={event.heroUrl || event.bannerUrl || presentation.child?.bannerUrl || null}
    title={event.title}
    badge={`Event · ${games} ${games === 1 ? "game" : "games"}`}
    meta={[
      { label: "Organizer", value: event.organizer || "Quest E-sports" },
      { label: "Location", value: event.venue || event.location || "To be announced" },
      { label: "Registration Closing Date", value: formatTournamentDate(event.registrationCloseAt) },
      { label: "Event Start Date", value: formatTournamentDate(event.startDate) },
    ]}
    statusLabel={presentation.eventStatus.label}
    statusTone={presentation.eventStatus.key === "open" ? "open" : presentation.eventStatus.key === "closed" ? "closed" : "muted"}
    preload={preload}
    eager={eager}
  />;
}
