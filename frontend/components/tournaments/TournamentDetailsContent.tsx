"use client";

import Image from "next/image";
import Link from "next/link";
import RegisterTournamentButton from "@/components/tournaments/RegisterTournamentButton";
import TournamentInfoList from "@/components/tournaments/TournamentInfoList";
import { Tournament } from "@/lib/tournaments";

export default function TournamentDetailsContent({
  tournament,
}: {
  tournament: Tournament;
}) {
  return (
    <section className="tournaments-section" style={{ padding: "24px 0 50px" }}>
      <div className="container">
        <div className="tournament-item tournament-item-detail">
          <div className="tournament-image">
            {tournament.image ? (
              <Image
                src={tournament.image}
                alt={tournament.title}
                width={1000}
                height={800}
              />
            ) : (
              <div className="coming-soon-block">
                <span>COMING SOON</span>
              </div>
            )}
          </div>

          <div className="tournament-details">
            <div className="tournament-detail-top">
              <div>
                <p className="tournament-eyebrow">Tournament Details</p>
                <h2>{tournament.title}</h2>
              </div>
              <Link href="/tournaments" className="btn btn-secondary btn-small">
                Back to Tournaments
              </Link>
            </div>

            <TournamentInfoList tournament={tournament} />

            <p className="description">{tournament.description}</p>

            <div className="tournament-actions">
              <RegisterTournamentButton tournament={tournament} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
