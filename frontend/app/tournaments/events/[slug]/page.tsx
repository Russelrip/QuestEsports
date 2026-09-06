import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import PageLayout from "@/components/PageLayout";
import { PageTransition } from "@/components/ui/page-transition";
import EventHero from "@/components/tournaments/event/EventHero";
import EventOverview from "@/components/tournaments/event/EventOverview";
import EventTournamentList from "@/components/tournaments/event/EventTournamentList";
import { ApiRequestError } from "@/lib/api";
import { fetchPublicEventBySlug } from "@/lib/tournaments";
import { buildPageMetadata } from "@/lib/site";

const getEvent = cache(fetchPublicEventBySlug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  try {
    const event = await getEvent(slug);
    return buildPageMetadata({
      title: event.title,
      description: event.shortDescription || event.description,
      path: `/tournaments/events/${event.slug}`,
      image: event.heroUrl || event.bannerUrl || undefined,
      keywords: [event.title, "Sri Lankan esports event", "multi-game tournament"],
    });
  } catch {
    return { title: "Event Not Found", robots: { index: false, follow: false } };
  }
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let event;
  try {
    event = await getEvent(slug);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }

  return (
    <PageLayout title={event.title} description={event.shortDescription || event.description}>
      <PageTransition>
        <EventHero event={event} />
        <nav aria-label="Event sections" className="border-b border-white/10 bg-[#0d0c13]"><div className="mx-auto flex max-w-7xl gap-6 px-5 py-4 text-sm sm:px-8"><a className="text-purple-200 underline-offset-4 hover:underline" href="#overview">Overview</a><a className="text-purple-200 underline-offset-4 hover:underline" href="#tournaments">Games</a></div></nav>
        <EventOverview event={event} />
        <EventTournamentList event={event} />
      </PageTransition>
    </PageLayout>
  );
}
