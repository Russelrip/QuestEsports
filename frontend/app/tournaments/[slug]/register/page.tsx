import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ConfiguredTournamentRegistrationForm from "@/components/tournament-registration/ConfiguredTournamentRegistrationForm";
import PageLayout from "@/components/PageLayout";
import { Container } from "@/components/ui/container";
import { buildNoIndexMetadata } from "@/lib/site";
import { fetchPublicTournamentBySlug } from "@/lib/tournaments";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tournament = await fetchPublicTournamentBySlug(slug).catch(() => null);
  return buildNoIndexMetadata(
    tournament ? `Register — ${tournament.title}` : "Tournament Registration",
    tournament ? `Register for ${tournament.title}.` : "Tournament registration page.",
    `/tournaments/${slug}/register`
  );
}

export default async function TournamentRegisterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tournament = await fetchPublicTournamentBySlug(slug).catch(() => null);
  if (!tournament) notFound();
  return (
    <PageLayout
      title="Tournament Registration"
      description={`Register for ${tournament.title}.`}
    >
      <section className="py-8 sm:py-12">
        <Container>
          <ConfiguredTournamentRegistrationForm tournament={tournament} />
        </Container>
      </section>
    </PageLayout>
  );
}
