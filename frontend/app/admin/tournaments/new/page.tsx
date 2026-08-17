import TournamentEditor from "@/components/admin/TournamentEditor";
import { buildNoIndexMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Create Tournament",
  defaultPageDescriptions.adminTournaments,
  "/admin/tournaments/new"
);

export default async function AdminNewTournamentPage({ searchParams }: { searchParams: Promise<{ seriesId?: string; seriesOrder?: string }> }) {
  const query = await searchParams;
  return <TournamentEditor initialSeriesId={query.seriesId} initialSeriesOrder={query.seriesOrder ? Number(query.seriesOrder) : undefined} />;
}
