import PageLayout from "@/components/PageLayout";
import TournamentsContent from "@/components/tournaments/TournamentsContent";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";
import { fetchPublicTournaments } from "@/lib/tournaments";

export const metadata = buildPageMetadata({
  title: "Tournaments",
  description: defaultPageDescriptions.tournaments,
  path: "/tournaments",
  keywords: [
    "upcoming esports tournaments",
    "VALORANT events Sri Lanka",
    "gaming brackets",
    "register team tournament",
  ],
});

export default async function TournamentsPage() {
  const tournaments = await fetchPublicTournaments();

  return (
    <PageLayout title="Tournaments" description={defaultPageDescriptions.tournaments}>
      <TournamentsContent tournaments={tournaments} />
    </PageLayout>
  );
}
