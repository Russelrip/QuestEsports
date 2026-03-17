import PageLayout from "@/components/PageLayout";
import TournamentRegistrationForm from "@/components/tournament-registration/TournamentRegistrationForm";
import { defaultPageDescriptions } from "@/lib/site";
import { fetchRegisterableTournaments } from "@/lib/tournaments";

export default async function TournamentRegistrationPage() {
  const tournaments = await fetchRegisterableTournaments();

  return (
    <PageLayout
      title="Tournament Registration"
      description={defaultPageDescriptions.tournamentRegistration}
    >
      <TournamentRegistrationForm tournaments={tournaments} />
    </PageLayout>
  );
}
