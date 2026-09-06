import PageLayout from "@/components/PageLayout";
import TournamentsContent from "@/components/tournaments/TournamentsContent";
import EmptyState from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";
import {
  fetchPublicEvents,
  fetchPublicTournaments,
  fetchPublicGameCategories,
} from "@/lib/tournaments";

export const revalidate = 15;

export const metadata = buildPageMetadata({
  title: "Tournaments",
  description: defaultPageDescriptions.tournaments,
  path: "/tournaments",
  keywords: [
    "upcoming e-sports tournaments",
    "VALORANT events Sri Lanka",
    "gaming brackets",
    "register team tournament",
    "Quest E-sports events",
    "multi-game tournament event",
  ],
});

export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string }>;
}) {
  const { game = "all" } = await searchParams;
  let tournaments: Awaited<ReturnType<typeof fetchPublicTournaments>> = [];
  let events: Awaited<ReturnType<typeof fetchPublicEvents>> = [];
  let categories: Awaited<ReturnType<typeof fetchPublicGameCategories>> = [];
  let loadError = false;

  try {
    [tournaments, events, categories] = await Promise.all([
      fetchPublicTournaments(),
      fetchPublicEvents(),
      fetchPublicGameCategories(),
    ]);
  } catch {
    loadError = true;
  }

  return (
    <PageLayout title="Tournaments" description={defaultPageDescriptions.tournaments}>
      {loadError ? (
        <Section className="pt-6">
          <EmptyState
            title="Tournaments unavailable"
            description="Tournaments are temporarily unavailable. Please try again shortly."
          />
        </Section>
      ) : (
        <TournamentsContent
          tournaments={tournaments}
          events={events}
          categories={categories}
          initialGameFilter={game}
        />
      )}
    </PageLayout>
  );
}
