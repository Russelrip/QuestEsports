"use client";

import Link from "next/link";
import RegisterTournamentButton from "@/components/tournaments/RegisterTournamentButton";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import TournamentInfoList from "@/components/tournaments/TournamentInfoList";
import { Tournament } from "@/lib/tournaments";

export default function TournamentDetailsContent({
  tournament,
}: {
  tournament: Tournament;
}) {
  return (
    <section className="tournaments-section tournament-detail-section">
      <div className="container">
        <div className="tournament-item tournament-item-detail">
          <div className="tournament-image">
            <TournamentBannerImage
              bannerUrl={tournament.bannerUrl}
              title={tournament.title}
            />
          </div>

          <div className="tournament-details">
            <div className="tournament-detail-top">
              <div className="tournament-detail-heading">
                <p className="tournament-eyebrow">Tournament Details</p>
                <h2>{tournament.title}</h2>
              </div>
              <Link href="/tournaments" className="btn btn-secondary btn-small tournament-back-btn">
                Back to Tournaments
              </Link>
            </div>

            <TournamentInfoList tournament={tournament} />

            <div className="tournament-rich-copy">
              <section className="tournament-copy-card">
                <h3>Rules</h3>
                <p>{tournament.rules || "Rules will be shared by the admins soon."}</p>
              </section>
            </div>

            <div className="tournament-link-row">
              {tournament.bracketLink ? (
                <a
                  href={tournament.bracketLink}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary btn-small"
                >
                  View Bracket
                </a>
              ) : null}
              {tournament.contactLink ? (
                <a
                  href={tournament.contactLink}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary btn-small"
                >
                  Discord / Contact
                </a>
              ) : null}
            </div>

            <div className="tournament-actions">
              <RegisterTournamentButton tournament={tournament} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
