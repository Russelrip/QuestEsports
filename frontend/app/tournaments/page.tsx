import PageLayout from "@/components/PageLayout";
import TournamentsContent from "@/components/tournaments/TournamentsContent";
import { defaultPageDescriptions } from "@/lib/site";

export default function TournamentsPage() {
  return (
    <PageLayout title="Tournaments" description={defaultPageDescriptions.tournaments}>
      <TournamentsContent />
    </PageLayout>
  );
}
