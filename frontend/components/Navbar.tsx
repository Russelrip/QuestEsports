"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import UserMenu from "@/components/UserMenu";
import { authNavItems, primaryNavItems } from "@/lib/site";

export default function Navbar() {
  const pathname = usePathname();
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <nav className="navbar">
      <div className="nav-container">
        <div className="nav-top-row">
          <Link href="/" className="logo" onClick={closeMenu}>
            <Image
              src="/images/logo-header.png"
              alt="Quest Esports Logo"
              width={130}
              height={90}
              priority
            />
          </Link>
          <button
            type="button"
            className={`nav-toggle ${isMenuOpen ? "open" : ""}`}
            aria-expanded={isMenuOpen}
            aria-controls="primary-navigation"
            aria-label={isMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setIsMenuOpen((current) => !current)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>

        <div
          id="primary-navigation"
          className={`nav-panel ${isMenuOpen ? "open" : ""}`}
        >
          <ul className="nav-menu">
            {primaryNavItems.map(({ href, label }) => (
              <li key={href} className="nav-item nav-item-primary">
                <Link
                  href={href}
                  className={pathname === href ? "active" : ""}
                  onClick={closeMenu}
                >
                  {label}
                </Link>
              </li>
            ))}
            {!isLoading && isAuthenticated && user ? (
              <>
                <UserMenu
                  user={user}
                  logout={logout}
                  onNavigate={closeMenu}
                  isAdmin={user.role === "admin"}
                />
              </>
            ) : !isLoading ? (
              <li className="nav-item nav-item-auth nav-auth-inline">
                {authNavItems.map(({ href, label }, index) => (
                  <div key={href} className="nav-auth-inline-segment">
                    {index > 0 ? (
                      <span className="nav-auth-divider" aria-hidden="true">
                        /
                      </span>
                    ) : null}
                    <Link
                      href={href}
                      className={pathname === href ? "active" : ""}
                      onClick={closeMenu}
                    >
                      {label}
                    </Link>
                  </div>
                ))}
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    </nav>
  );
}
