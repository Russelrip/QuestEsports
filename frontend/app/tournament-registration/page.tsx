import { Suspense } from "react";
import PageLayout from "@/components/PageLayout";
import TournamentRegistrationForm from "@/components/tournament-registration/TournamentRegistrationForm";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";
import { fetchRegisterableTournaments, type Tournament } from "@/lib/tournaments";

export const dynamic = "force-dynamic";

export const metadata = buildPageMetadata({
  title: "Tournament Registration",
  description: defaultPageDescriptions.tournamentRegistration,
  path: "/tournament-registration",
  keywords: [
    "tournament registration form",
    "register team valorant",
    "e-sports sign up",
    "team roster submission",
  ],
});

export default async function TournamentRegistrationPage() {
  let tournaments: Tournament[] = [];

  try {
    tournaments = await fetchRegisterableTournaments();
  } catch (error) {
    console.error("Unable to load registerable tournaments:", error);
  }

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
