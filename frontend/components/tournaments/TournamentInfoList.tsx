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
      <div className="tournament-info-item">
        <span className="tournament-info-label">Game</span>
        <span className="tournament-info-value tournament-info-value-caps">
          {tournament.game}
        </span>
      </div>
      <div className="tournament-info-item">
        <span className="tournament-info-label">Prize Pool</span>
        <span className="tournament-info-value">{tournament.prizePool}</span>
      </div>
      <div className="tournament-info-item">
        <span className="tournament-info-label">Team Size</span>
        <span className="tournament-info-value">
          {tournament.teamSize}v{tournament.teamSize}
        </span>
      </div>
      <div className="tournament-info-item">
        <span className="tournament-info-label">Slots</span>
        <span className="tournament-info-value">
          {tournament.registrationCount} / {tournament.maxTeams}
        </span>
      </div>
      <div className="tournament-info-item">
        <span className="tournament-info-label">Registration Deadline</span>
        <span className="tournament-info-value">
          {formatDate(tournament.registrationDeadline)}
        </span>
      </div>
      <div className="tournament-info-item">
        <span className="tournament-info-label">Event Dates</span>
        <span className="tournament-info-value">
          {formatDate(tournament.startDate)} - {formatDate(tournament.endDate)}
        </span>
      </div>
      <div className="tournament-info-item">
        <span className="tournament-info-label">Status</span>
        <span className="tournament-info-value">
          <span className={getTournamentStatusBadgeClassName(tournament.status)}>
            {getTournamentStatusLabel(tournament.status)}
          </span>
        </span>
      </div>
      <div className="tournament-info-item">
        <span className="tournament-info-label">Registration</span>
        <span className="tournament-info-value">
          {getTournamentRegistrationLabel(tournament)}
        </span>
      </div>
    </div>
  );
}
