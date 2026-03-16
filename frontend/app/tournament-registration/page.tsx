import PageHeader from "@/components/PageHeader";
import TournamentRegistrationForm from "@/components/tournament-registration/TournamentRegistrationForm";

export default function TournamentRegistrationPage() {
  return (
    <>
      <PageHeader
        title="Tournament Registration"
        description="Register your team for upcoming tournaments"
      />
      <TournamentRegistrationForm />
    </>
  );
}
