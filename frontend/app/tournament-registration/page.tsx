import PageLayout from "@/components/PageLayout";
import TournamentRegistrationForm from "@/components/tournament-registration/TournamentRegistrationForm";
import { defaultPageDescriptions } from "@/lib/site";

export default function TournamentRegistrationPage() {
  return (
    <PageLayout
      title="Tournament Registration"
      description={defaultPageDescriptions.tournamentRegistration}
    >
      <TournamentRegistrationForm />
    </PageLayout>
  );
}
