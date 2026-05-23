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

  return <TournamentEditor tournamentId={id} />;
}
