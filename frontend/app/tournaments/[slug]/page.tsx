import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import StructuredData from "@/components/StructuredData";
import TournamentDetailsContent from "@/components/tournaments/TournamentDetailsContent";
import { PageTransition } from "@/components/ui/page-transition";
import {
  buildBreadcrumbStructuredData,
  buildTournamentMetadata,
  buildTournamentStructuredData,
} from "@/lib/site";
import { Tournament, fetchPublicTournamentBySlug } from "@/lib/tournaments";
import { ApiRequestError } from "@/lib/api";

const getTournament = cache(fetchPublicTournamentBySlug);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  try {
    const tournament = await getTournament(slug);
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
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const { slug } = await params;
  const { payment } = await searchParams;
  let tournament: Tournament;
  try {
    tournament = await getTournament(slug);
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 404) throw error;
    notFound();
  }

  return (
    <PageTransition>
      <StructuredData data={buildTournamentStructuredData(tournament)} />
      <StructuredData
        data={buildBreadcrumbStructuredData([
          { name: "Home", path: "/" },
          { name: "Tournaments", path: "/tournaments" },
          { name: tournament.title, path: `/tournaments/${tournament.slug}` },
        ])}
      />
      <TournamentDetailsContent tournament={tournament} paymentCancelled={payment === "cancelled"} />
    </PageTransition>
  );
}
