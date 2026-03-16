import { isTournamentCompleted, Tournament } from "@/lib/tournaments";

export default function TournamentInfoList({
  tournament,
}: {
  tournament: Tournament;
}) {
  return (
    <div className="tournament-info">
      <p>
        <strong>Prize Pool:</strong> {tournament.prizePool}
      </p>

      {tournament.completed ? (
        <p>
          <strong>Completed:</strong>{" "}
          <span className="completed-date-inline">{tournament.completed}</span>
        </p>
      ) : null}

      <p>
        <strong>Format:</strong> {tournament.format}
      </p>

      <p>
        <strong>Status:</strong>{" "}
        {isTournamentCompleted(tournament) ? (
          <span className="status status-completed">{tournament.status}</span>
        ) : (
          tournament.status
        )}
      </p>

      {tournament.registration ? (
        <p>
          <strong>Registration:</strong> {tournament.registration}
        </p>
      ) : null}
    </div>
  );
}
