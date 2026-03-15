import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-content">
          <h2>
            Welcome to <br /> QUEST E-SPORTS LK
          </h2>
          <p>Compete, Connect, Conquer</p>
          <Link href="/tournaments" className="btn btn-primary">
            View Tournaments
          </Link>
          <Link href="/signup" className="btn btn-secondary">
            Join Now
          </Link>
        </div>
      </section>

      <section className="about-section">
        <div className="container">
          <h2>About Quest Esports</h2>
          <p className="section-intro">
            Quest Esports is a Sri Lankan esports organization focused on
            building competitive gaming experiences and growing the local esports
            community. We organize exciting tournaments, create opportunities for
            players to showcase their talent, and aim to provide a professional
            platform for both rising and experienced gamers. Through passion,
            teamwork, and innovation, Quest Esports is dedicated to shaping the
            future of esports in Sri Lanka.
          </p>
        </div>
      </section>

      <section className="team-section">
        <div className="container">
          <h2>Meet the Quest Esports Team</h2>
          <p className="section-intro">
            Passionate esports enthusiasts building tournaments and community
            experiences.
          </p>

          <div className="team-grid">
            <div className="team-member">
              <img src="/images/sahan.jpg" alt="Sahan Jayasuriya" />
              <h3>Sahan Jayasuriya</h3>
              <p>Owner</p>
            </div>

            <div className="team-member">
              <img src="/images/senumi.jpg" alt="Senumi Ekanayake" />
              <h3>Senumi Ekanayake</h3>
              <p>Owner / Founder</p>
            </div>

            <div className="team-member">
              <img src="/images/russel.jpg" alt="Russel Perera" />
              <h3>Russel Perera</h3>
              <p>Director / Co-Owner</p>
            </div>

            <div className="team-member">
              <img src="/images/deshika.jpg" alt="Deshika Peiris" />
              <h3>Deshika Peiris</h3>
              <p>Head Admin</p>
            </div>
          </div>
        </div>
      </section>

      <section className="featured">
        <div className="container">
          <h2>Featured Tournaments</h2>

          <div className="tournament-grid">
            <div className="tournament-card">
              <img
                src="/images/womens.jpg"
                alt="Valorant Women's Championship 2025"
                className="tournament-poster-img"
              />
              <h3>Valorant Women&apos;s Championship 2025</h3>
              <p>LKR 50,000 Prize Pool</p>

              <div className="tournament-card-footer">
                <p className="date completed-date">Completed - August 2025</p>
                <Link href="/tournaments" className="btn btn-small btn-primary">
                  View Details
                </Link>
              </div>
            </div>

            <div className="tournament-card">
              <img
                src="/images/open.jpg"
                alt="The Valorant Showdown 2026"
                className="tournament-poster-img"
              />
              <h3>The Valorant Showdown 2026</h3>
              <p>LKR 40,000 Prize Pool</p>

              <div className="tournament-card-footer">
                <p className="date completed-date">Completed - February 12</p>
                <Link href="/tournaments" className="btn btn-small btn-primary">
                  View Details
                </Link>
              </div>
            </div>

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
    </>
  );
}