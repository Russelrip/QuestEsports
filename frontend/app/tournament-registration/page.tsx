import PageHeader from "@/components/PageHeader";
import TournamentRegistrationForm from "@/components/tournament-registration/TournamentRegistrationForm";

export default function TournamentRegistrationPage() {
  return (
    <>
      {/* This route hosts the full tournament registration workflow with backend submission. */}
      <PageHeader
        title="Tournament Registration"
        description="Register your team for upcoming tournaments"
      />
      <TournamentRegistrationForm />
    </>
  );
}
