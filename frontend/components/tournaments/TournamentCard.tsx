import TournamentGridCard from "@/components/tournaments/TournamentGridCard";
import { getTournamentRegistrationPresentation, type Tournament } from "@/lib/tournaments";
import { formatTournamentDate } from "@/lib/utils";

export default function TournamentCard({ tournament, preload = false, eager = false }: { tournament: Tournament; preload?: boolean; eager?: boolean }) {
  const registrationPresentation = getTournamentRegistrationPresentation(tournament);
  return <TournamentGridCard
    href={`/tournaments/${tournament.slug}`}
    bannerUrl={tournament.bannerUrl}
    title={tournament.title}
    meta={[
      { label: "Organizer", value: tournament.organizer },
      { label: "Location", value: tournament.location },
      { label: "Registration Closing Date", value: formatTournamentDate(tournament.registrationDeadline, tournament.registrationDeadlineStatus) },
      { label: "Event Start Date", value: formatTournamentDate(tournament.startDate, tournament.startDateStatus) },
    ]}
    statusLabel={tournament.isCompleted ? "Completed" : registrationPresentation.label}
    statusTone={tournament.isCompleted ? "closed" : registrationPresentation.isActionable ? "open" : "muted"}
    preload={preload}
    eager={eager}
  />;
}
