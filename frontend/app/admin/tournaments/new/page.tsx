import TournamentEditor from "@/components/admin/TournamentEditor";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Create Tournament",
  defaultPageDescriptions.adminTournaments,
  "/admin/tournaments/new"
);

export default function AdminNewTournamentPage() {
  return <TournamentEditor />;
}
