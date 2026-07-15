import PageLayout from "@/components/PageLayout";
import TournamentsContent from "@/components/tournaments/TournamentsContent";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";
import {
  fetchPublicEventSeries,
  fetchPublicTournaments,
  fetchPublicGameCategories,
} from "@/lib/tournaments";

export const dynamic = "force-dynamic";

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

export default async function TournamentsPage() {
  const [tournaments, series, categories] = await Promise.all([
    fetchPublicTournaments(),
    fetchPublicEventSeries(),
    fetchPublicGameCategories(),
  ]);

  return (
    <PageLayout title="Tournaments" description={defaultPageDescriptions.tournaments}>
      <TournamentsContent tournaments={tournaments} series={series} categories={categories} />
    </PageLayout>
  );
}
