import PageLayout from "@/components/PageLayout";
import TournamentsContent from "@/components/tournaments/TournamentsContent";
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
  ],
});

export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string }>;
}) {
  const { game = "all" } = await searchParams;
  const [tournaments, series, categories] = await Promise.all([
    fetchPublicTournaments(),
    fetchPublicEvents(),
    fetchPublicGameCategories(),
  ]);

  return (
    <PageLayout title="Tournaments" description={defaultPageDescriptions.tournaments}>
      <TournamentsContent
        tournaments={tournaments}
        series={series}
        categories={categories}
        initialGameFilter={game}
      />
    </PageLayout>
  );
}
