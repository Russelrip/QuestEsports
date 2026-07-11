import PageLayout from "@/components/PageLayout";
import TournamentsContent from "@/components/tournaments/TournamentsContent";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";
import { fetchPublicTournaments, type Tournament } from "@/lib/tournaments";

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
  let tournaments: Tournament[] = [];

  try {
    tournaments = await fetchPublicTournaments();
  } catch (error) {
    console.error("Unable to load tournaments:", error);
  }

  return (
    <PageLayout title="Tournaments" description={defaultPageDescriptions.tournaments}>
      <TournamentsContent tournaments={tournaments} />
    </PageLayout>
  );
}
