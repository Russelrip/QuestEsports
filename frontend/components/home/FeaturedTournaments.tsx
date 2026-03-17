import Link from "next/link";
import RegisterTournamentButton from "@/components/tournaments/RegisterTournamentButton";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import {
  fetchPublicTournaments,
  getFeaturedTournaments,
  getTournamentStatusLabel,
} from "@/lib/tournaments";

export default async function FeaturedTournaments() {
  const tournaments = await fetchPublicTournaments();
  const featuredTournaments = getFeaturedTournaments(tournaments);

  return (
    <section className="featured">
      <div className="container">
        <h2>Featured Tournaments</h2>
        <div className="tournament-grid featured-tournament-grid">
          {featuredTournaments.map((tournament) => (
            <div className="tournament-card featured-tournament-card" key={tournament.id}>
              <TournamentBannerImage
                bannerUrl={tournament.bannerUrl}
                title={tournament.title}
                className="featured-tournament-img"
              />
              <h3>{tournament.title}</h3>
              <p>{tournament.prizePool} Prize Pool</p>
              <p>{tournament.format}</p>

              <div className="tournament-card-footer">
                <p className="date">{getTournamentStatusLabel(tournament.status)}</p>
                <Link
                  href={`/tournaments/${tournament.slug}`}
                  className="btn btn-small btn-secondary"
                >
                  View Details
                </Link>
                <RegisterTournamentButton
                  tournament={tournament}
                  className="featured-register-cta"
                />
              </div>
            </div>
          ))}

          {featuredTournaments.length === 0 ? (
            <div className="tournament-card coming-soon-card">
              <div className="coming-soon-visual">
                <span>COMING SOON</span>
              </div>
              <h3>Coming Soon</h3>
              <p>Stay tuned for more upcoming Quest Esports tournaments.</p>
              <p className="date">Check back regularly</p>
              <Link href="/tournaments" className="btn btn-small btn-primary">
                View All
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
