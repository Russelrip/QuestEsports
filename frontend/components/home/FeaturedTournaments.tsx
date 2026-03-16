import Link from "next/link";

const featuredTournaments = [
  {
    title: "Valorant Women's Championship 2025",
    prize: "LKR 50,000 Prize Pool",
    date: "Completed - August 2025",
    image: "/images/womens.jpg",
    alt: "Valorant Women's Championship 2025",
  },
  {
    title: "The Valorant Showdown 2026",
    prize: "LKR 40,000 Prize Pool",
    date: "Completed - February 12",
    image: "/images/open.jpg",
    alt: "The Valorant Showdown 2026",
  },
];

export default function FeaturedTournaments() {
  return (
    <section className="featured">
      <div className="container">
        <h2>Featured Tournaments</h2>

        <div className="tournament-grid">
          {featuredTournaments.map((tournament) => (
            <div className="tournament-card" key={tournament.title}>
              <img
                src={tournament.image}
                alt={tournament.alt}
                className="tournament-poster-img"
              />
              <h3>{tournament.title}</h3>
              <p>{tournament.prize}</p>

              <div className="tournament-card-footer">
                <p className="date completed-date">{tournament.date}</p>
                <Link href="/tournaments" className="btn btn-small btn-primary">
                  View Details
                </Link>
              </div>
            </div>
          ))}

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
        </div>
      </div>
    </section>
  );
}
