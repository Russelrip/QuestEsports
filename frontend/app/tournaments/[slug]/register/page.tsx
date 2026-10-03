import type { Metadata } from "next";
import ConfiguredTournamentRegistrationForm from "@/components/tournament-registration/ConfiguredTournamentRegistrationForm";
import PageLayout from "@/components/PageLayout";
import { Container } from "@/components/ui/container";
import { buildNoIndexMetadata } from "@/lib/site";
import { fetchPublicTournamentBySlug } from "@/lib/tournaments";
import { redirectRenamedTournament } from "@/lib/tournament-slug-aliases";

const participantRequest = { participantPage: 1, participantPageSize: 10 };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tournament = await fetchPublicTournamentBySlug(slug, participantRequest).catch(() => null);
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
  const tournament = await fetchPublicTournamentBySlug(slug, participantRequest).catch(() => null);
  if (!tournament) redirectRenamedTournament(slug, "/register");
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
