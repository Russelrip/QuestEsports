"use client";

import { useMemo, useState } from "react";

const tournaments = [
  {
    title: "Valorant Women's Championship 2025",
    game: "valorant",
    image: "/images/womens.jpg",
    prizePool: "LKR 50,000",
    completed: "August 2025",
    format: "BO3 / 5v5",
    status: "Completed",
    description:
      "A special tournament created to spotlight women in competitive Valorant and support the local esports scene.",
  },
  {
    title: "The Valorant Showdown 2026",
    game: "valorant",
    image: "/images/open.jpg",
    prizePool: "LKR 40,000",
    completed: "February 12",
    format: "BO3 / 5v5",
    status: "Completed",
    description:
      "A competitive Valorant event featuring open teams, structured brackets, and a strong finals stage.",
  },
  {
    title: "Coming Soon",
    game: "all",
    image: null,
    prizePool: "To Be Announced",
    completed: null,
    format: "To Be Announced",
    status: "Planning Stage",
    description:
      "More Quest Esports tournaments are currently being planned. Stay tuned for upcoming announcements.",
    registration: "Coming Soon",
  },
];

export default function TournamentsPage() {
  const [gameFilter, setGameFilter] = useState("all");

  const filteredTournaments = useMemo(() => {
    if (gameFilter === "all") return tournaments;
    return tournaments.filter(
      (tournament) =>
        tournament.game === gameFilter || tournament.game === "all"
    );
  }, [gameFilter]);

  return (
    <>
      <section
        className="tournament-filters"
        style={{ padding: "22px 0 10px" }}
      >
        <div className="container">
          <div className="filter-group">
            <label htmlFor="gameFilter">Filter by Game:</label>
            <select
              id="gameFilter"
              className="filter-select"
              value={gameFilter}
              onChange={(e) => setGameFilter(e.target.value)}
            >
              <option value="all">All Games</option>
              <option value="valorant">Valorant</option>
              <option value="pubg-mobile">PUBG Mobile</option>
              <option value="cod-mobile">Call of Duty: Mobile</option>
              <option value="free-fire">Free Fire</option>
              <option value="dota-2">Dota 2</option>
              <option value="mobile-legends">Mobile Legends</option>
              <option value="ea-fc">EA FC</option>
            </select>
          </div>
        </div>
      </section>

      <section
        className="tournaments-section"
        style={{ padding: "12px 0 50px" }}
      >
        <div className="container">
          <div className="tournament-list">
            {filteredTournaments.map((tournament) => (
              <div
                className="tournament-item"
                data-game={tournament.game}
                key={tournament.title}
              >
                <div className="tournament-image">
                  {tournament.image ? (
                    <img src={tournament.image} alt={tournament.title} />
                  ) : (
                    <div className="coming-soon-block">
                      <span>COMING SOON</span>
                    </div>
                  )}
                </div>

                <div className="tournament-details">
                  <h2>{tournament.title}</h2>

                  <div className="tournament-info">
                    <p>
                      <strong>Prize Pool:</strong> {tournament.prizePool}
                    </p>

                    {tournament.completed && (
                      <p>
                        <strong>Completed:</strong>{" "}
                        <span className="completed-date-inline">
                          {tournament.completed}
                        </span>
                      </p>
                    )}

                    <p>
                      <strong>Format:</strong> {tournament.format}
                    </p>

                    <p>
                      <strong>Status:</strong>{" "}
                      {tournament.status === "Completed" ? (
                        <span className="status status-completed">
                          {tournament.status}
                        </span>
                      ) : (
                        tournament.status
                      )}
                    </p>

                    {"registration" in tournament && tournament.registration && (
                      <p>
                        <strong>Registration:</strong> {tournament.registration}
                      </p>
                    )}
                  </div>

                  <p className="description">{tournament.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}