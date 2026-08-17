import type { Metadata } from "next";
import { notFound } from "next/navigation";
import TicketCheckout from "@/components/tickets/TicketCheckout";
import { Container } from "@/components/ui/container";
import { PageTransition } from "@/components/ui/page-transition";
import EventHero from "@/components/tournaments/event/EventHero";
import EventOverview from "@/components/tournaments/event/EventOverview";
import EventTournamentList from "@/components/tournaments/event/EventTournamentList";
import { fetchPublicEventSeriesBySlug } from "@/lib/tournaments";
import { ApiRequestError } from "@/lib/api";
import { buildNoIndexMetadata, buildPageMetadata } from "@/lib/site";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  try {
    const { slug } = await params;
    const series = await fetchPublicEventSeriesBySlug(slug);
    return buildPageMetadata({
      title: series.title,
      description: series.description,
      path: `/events/${series.slug}`,
      image: series.heroUrl || undefined,
      keywords: [
        series.title,
        "e-sports tournament series",
        "Sri Lanka gaming events",
      ],
    });
  } catch {
    return buildNoIndexMetadata(
      "Event Not Found",
      "This event series could not be found.",
      "/tournaments"
    );
  }
}

export default async function EventSeriesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let series;
  try { series = await fetchPublicEventSeriesBySlug(slug); }
  catch (error) { if (error instanceof ApiRequestError && error.status === 404) notFound(); throw error; }

  return (
    <PageTransition>
      <EventHero event={series} />
      <EventOverview event={series} />

      {series.ticketEvent ? (
        <section className="border-b border-white/10 bg-white/[0.02] py-10 sm:py-14">
          <Container>
            <div className="mb-7 max-w-3xl border-l-2 border-purple-300 pl-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-200">
                LAN entrance fee
              </p>
              <h2 className="mt-3 text-3xl text-white">Get your event entrance pass</h2>
              <p className="mt-3 text-sm leading-7 text-slate-400">
                This fee is for entry to {series.title}. Tournament registration is handled separately for each game below.
              </p>
            </div>
            <TicketCheckout event={series.ticketEvent} />
          </Container>
        </section>
      ) : null}

      <EventTournamentList event={series} />
    </PageTransition>
  );
}
