import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="nav-container">
        <Link href="/" className="logo">
          <img src="/images/logo-header.png" alt="Quest Esports Logo" />
        </Link>

        <ul className="nav-menu">
          <li>
            <Link href="/" className="active">
              Home
            </Link>
          </li>
          <li>
            <Link href="/tournaments">Tournaments</Link>
          </li>
          <li>
            <Link href="/match-videos">Match Videos</Link>
          </li>
          <li>
            <Link href="/gallery">Gallery</Link>
          </li>
          <li>
            <Link href="/tournament-registration">Tournament Registration</Link>
          </li>
          <li>
            <Link href="/registration">Registration</Link>
          </li>
          <li>
            <Link href="/rulebook">Rulebook</Link>
          </li>
          <li>
            <Link href="/contact">Contact Us</Link>
          </li>
          <li>
            <Link href="/signup">Sign Up</Link>
          </li>
          <li>
            <Link href="/login">Login</Link>
          </li>
        </ul>
      </div>
    </nav>
  );
}
