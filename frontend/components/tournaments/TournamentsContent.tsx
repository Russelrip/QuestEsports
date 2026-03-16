"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import RegisterTournamentButton from "@/components/tournaments/RegisterTournamentButton";
import TournamentInfoList from "@/components/tournaments/TournamentInfoList";
import EmptyState from "@/components/ui/EmptyState";
import { getVisibleTournaments } from "@/lib/tournaments";

export default function TournamentsContent() {
  const [gameFilter, setGameFilter] = useState("all");

  const filteredTournaments = useMemo(() => {
    return getVisibleTournaments(gameFilter);
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
          {filteredTournaments.length > 0 ? (
            <div className="tournament-list">
              {filteredTournaments.map((tournament) => (
                <div
                  className="tournament-item"
                  data-game={tournament.game}
                  key={tournament.slug}
                >
                  <div className="tournament-image">
                    {tournament.image ? (
                      <Link href={`/tournaments/${tournament.slug}`}>
                        <Image
                          src={tournament.image}
                          alt={tournament.title}
                          width={800}
                          height={600}
                        />
                      </Link>
                    ) : (
                      <div className="coming-soon-block">
                        <span>COMING SOON</span>
                      </div>
                    )}
                  </div>

                  <div className="tournament-details">
                    <Link href={`/tournaments/${tournament.slug}`}>
                      <h2>{tournament.title}</h2>
                    </Link>

                    <TournamentInfoList tournament={tournament} />

                    <p className="description">{tournament.description}</p>

                    <div className="tournament-actions">
                      <Link
                        href={`/tournaments/${tournament.slug}`}
                        className="btn btn-secondary"
                      >
                        View Details
                      </Link>
                      <RegisterTournamentButton tournament={tournament} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No tournaments available right now"
              description="More Quest Esports tournaments are currently being planned. Stay tuned for upcoming announcements."
            >
              <div className="coming-soon-block">
                <span>COMING SOON</span>
              </div>
            </EmptyState>
          )}
        </div>
      </section>
    </>
  );
}
