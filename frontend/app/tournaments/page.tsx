import PageLayout from "@/components/PageLayout";
import TournamentsContent from "@/components/tournaments/TournamentsContent";
import { defaultPageDescriptions } from "@/lib/site";
import { fetchPublicTournaments } from "@/lib/tournaments";

export default async function TournamentsPage() {
  const tournaments = await fetchPublicTournaments();

  return (
    <PageLayout title="Tournaments" description={defaultPageDescriptions.tournaments}>
      <TournamentsContent tournaments={tournaments} />
    </PageLayout>
  );
}
