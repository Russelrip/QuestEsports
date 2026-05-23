import AdminTournamentsManager from "@/components/admin/AdminTournamentsManager";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Tournament Management",
  defaultPageDescriptions.adminTournaments,
  "/admin/tournaments"
);

export default function AdminTournamentsPage() {
  return <AdminTournamentsManager />;
}
