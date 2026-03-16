import { notFound } from "next/navigation";
import PageLayout from "@/components/PageLayout";
import TournamentDetailsContent from "@/components/tournaments/TournamentDetailsContent";
import { getTournamentBySlug } from "@/lib/tournaments";

export default async function TournamentDetailsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tournament = getTournamentBySlug(slug);

  if (!tournament) {
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
