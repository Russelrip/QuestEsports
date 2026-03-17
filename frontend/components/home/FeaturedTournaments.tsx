import Link from "next/link";
import TournamentBannerImage from "@/components/tournaments/TournamentBannerImage";
import {
  fetchPublicTournaments,
  getFeaturedTournaments,
  getTournamentStatusBadgeClassName,
  getTournamentStatusLabel,
} from "@/lib/tournaments";

const formatTournamentDateRange = (startDate: string, endDate: string) => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });

  const fullFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Dates to be announced";
  }

  if (start.toDateString() === end.toDateString()) {
    return fullFormatter.format(start);
  }

  if (start.getFullYear() === end.getFullYear()) {
    return `${formatter.format(start)} - ${fullFormatter.format(end)}`;
  }

  return `${fullFormatter.format(start)} - ${fullFormatter.format(end)}`;
};

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
              <div className="featured-tournament-media">
                <TournamentBannerImage
                  bannerUrl={tournament.bannerUrl}
                  title={tournament.title}
                  className="featured-tournament-img"
                />
                <div className="featured-tournament-overlay">
                  <span
                    className={`featured-status-badge ${getTournamentStatusBadgeClassName(
                      tournament.status
                    )}`}
                  >
                    {getTournamentStatusLabel(tournament.status)}
                  </span>
                </div>
              </div>

              <div className="featured-tournament-content">
                <div className="featured-tournament-copy">
                  <p className="featured-tournament-game">{tournament.game}</p>
                  <h3>{tournament.title}</h3>
                  <p className="featured-tournament-inline-meta">
                    <span>{tournament.prizePool} Prize Pool</span>
                    <span>{formatTournamentDateRange(tournament.startDate, tournament.endDate)}</span>
                  </p>
                </div>

                <div className="tournament-card-footer featured-tournament-footer">
                  <Link
                    href={`/tournaments/${tournament.slug}`}
                    className="btn btn-primary featured-primary-btn"
                  >
                    View Tournament
                  </Link>
                </div>
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
