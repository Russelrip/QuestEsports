import type { Metadata } from "next";
import { notFound } from "next/navigation";
import StructuredData from "@/components/StructuredData";
import TournamentDetailsContent from "@/components/tournaments/TournamentDetailsContent";
import { PageTransition } from "@/components/ui/page-transition";
import {
  buildTournamentMetadata,
  buildTournamentStructuredData,
} from "@/lib/site";
import { Tournament, fetchPublicTournamentBySlug } from "@/lib/tournaments";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  try {
    const tournament = await fetchPublicTournamentBySlug(slug);
    return buildTournamentMetadata(tournament);
  } catch {
    return {
      title: "Tournament Not Found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }
}

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
    <PageTransition>
      <StructuredData data={buildTournamentStructuredData(tournament)} />
      <TournamentDetailsContent tournament={tournament} />
    </PageTransition>
  );
}
