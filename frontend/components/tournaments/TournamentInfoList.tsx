import {
  Tournament,
  getTournamentRegistrationLabel,
  getTournamentStatusBadgeClassName,
  getTournamentStatusLabel,
} from "@/lib/tournaments";

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

export default function TournamentInfoList({
  tournament,
}: {
  tournament: Tournament;
}) {
  return (
    <div className="tournament-info">
      <p>
        <strong>Game:</strong> {tournament.game}
      </p>
      <p>
        <strong>Prize Pool:</strong> {tournament.prizePool}
      </p>
      <p>
        <strong>Format:</strong> {tournament.format}
      </p>
      <p>
        <strong>Team Size:</strong> {tournament.teamSize}v{tournament.teamSize}
      </p>
      <p>
        <strong>Slots:</strong> {tournament.registrationCount} / {tournament.maxTeams}
      </p>
      <p>
        <strong>Registration Deadline:</strong> {formatDate(tournament.registrationDeadline)}
      </p>
      <p>
        <strong>Event Dates:</strong> {formatDate(tournament.startDate)} -{" "}
        {formatDate(tournament.endDate)}
      </p>
      <p>
        <strong>Status:</strong>{" "}
        <span className={getTournamentStatusBadgeClassName(tournament.status)}>
          {getTournamentStatusLabel(tournament.status)}
        </span>
      </p>
      <p>
        <strong>Registration:</strong> {getTournamentRegistrationLabel(tournament)}
      </p>
    </div>
  );
}
