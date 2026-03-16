import Image from "next/image";
import Link from "next/link";
import RegisterTournamentButton from "@/components/tournaments/RegisterTournamentButton";
import {
  getFeaturedTournaments,
  isTournamentCompleted,
} from "@/lib/tournaments";

export default function FeaturedTournaments() {
  const featuredTournaments = getFeaturedTournaments();

  return (
    <section className="featured">
      <div className="container">
        <h2>Featured Tournaments</h2>
        <div className="tournament-grid">
          {featuredTournaments.map((tournament) => (
            <div className="tournament-card" key={tournament.slug}>
              <Image
                src={tournament.image}
                alt={tournament.title}
                className="tournament-poster-img"
                width={800}
                height={1140}
              />
              <h3>{tournament.title}</h3>
              <p>{tournament.prizePool} Prize Pool</p>
              <p>{tournament.format}</p>

              <div className="tournament-card-footer">
                {isTournamentCompleted(tournament) ? (
                  <p className="date completed-date">
                    Completed - {tournament.completed}
                  </p>
                ) : (
                  <p className="date">{tournament.status}</p>
                )}
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
