import PageLayout from "@/components/PageLayout";
import TournamentEditor from "@/components/admin/TournamentEditor";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Create Tournament",
  defaultPageDescriptions.adminTournaments,
  "/admin/tournaments/new"
);

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
