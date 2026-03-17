import PageLayout from "@/components/PageLayout";
import TournamentEditor from "@/components/admin/TournamentEditor";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Edit Tournament",
  defaultPageDescriptions.adminTournaments,
  "/admin/tournaments/edit"
);

export default async function AdminEditTournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <PageLayout
      title="Edit Tournament"
      description={defaultPageDescriptions.adminTournaments}
    >
      <TournamentEditor tournamentId={id} />
    </PageLayout>
  );
}
