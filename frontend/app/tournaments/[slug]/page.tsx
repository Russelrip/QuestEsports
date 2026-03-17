import { notFound } from "next/navigation";
import PageLayout from "@/components/PageLayout";
import TournamentDetailsContent from "@/components/tournaments/TournamentDetailsContent";
import { Tournament, fetchPublicTournamentBySlug } from "@/lib/tournaments";

export default async function TournamentDetailsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let tournament: Tournament;
  try {
    tournament = await fetchPublicTournamentBySlug(slug);
  } catch {
    notFound();
  }

  return (
    <PageLayout
      title={tournament.title}
      description="View tournament status, details, and registration availability"
    >
      <TournamentDetailsContent tournament={tournament} />
    </PageLayout>
  );
}
