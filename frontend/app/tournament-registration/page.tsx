import { Suspense } from "react";
import PageLayout from "@/components/PageLayout";
import TournamentRegistrationForm from "@/components/tournament-registration/TournamentRegistrationForm";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";
import { fetchRegisterableTournaments } from "@/lib/tournaments";

export const metadata = buildPageMetadata({
  title: "Tournament Registration",
  description: defaultPageDescriptions.tournamentRegistration,
  path: "/tournament-registration",
  keywords: [
    "tournament registration form",
    "register team valorant",
    "esports sign up",
    "team roster submission",
  ],
});

export default async function TournamentRegistrationPage() {
  const tournaments = await fetchRegisterableTournaments();

  return (
    <PageLayout
      title="Tournament Registration"
      description={defaultPageDescriptions.tournamentRegistration}
    >
      <Suspense fallback={null}>
        <TournamentRegistrationForm tournaments={tournaments} />
      </Suspense>
    </PageLayout>
  );
}
