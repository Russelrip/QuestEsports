import PageLayout from "@/components/PageLayout";
import TournamentEditor from "@/components/admin/TournamentEditor";
import { defaultPageDescriptions } from "@/lib/site";

export default function AdminNewTournamentPage() {
  return (
    <PageLayout
      title="Create Tournament"
      description={defaultPageDescriptions.adminTournaments}
    >
      <TournamentEditor />
    </PageLayout>
  );
}
