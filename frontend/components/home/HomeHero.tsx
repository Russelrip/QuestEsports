import Link from "next/link";

export default function HomeHero() {
  return (
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
  );
}
