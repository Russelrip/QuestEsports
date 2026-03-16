"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { authNavItems, primaryNavItems } from "@/lib/site";

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, logout, isLoading } = useAuth();

  return (
    <nav className="navbar">
      <div className="nav-container">
        <Link href="/" className="logo">
          <Image
            src="/images/logo-header.png"
            alt="Quest Esports Logo"
            width={130}
            height={90}
            priority
          />
        </Link>
        <ul className="nav-menu">
          {primaryNavItems.map(({ href, label }) => (
            <li key={href}>
              <Link href={href} className={pathname === href ? "active" : ""}>
                {label}
              </Link>
            </li>
          ))}
          {!isLoading && isAuthenticated && user ? (
            <>
              <li className="nav-user-status">
                <span>Logged in as {user.username}</span>
              </li>
              <li>
                <Link
                  href="/profile"
                  className={pathname === "/profile" ? "active" : ""}
                >
                  Profile
                </Link>
              </li>
              {user.role === "admin" && (
                <li>
                  <Link
                    href="/admin"
                    className={pathname === "/admin" ? "active" : ""}
                  >
                    Admin
                  </Link>
                </li>
              )}
              <li>
                <button
                  type="button"
                  className="nav-logout"
                  onClick={async () => {
                    await logout();
                    router.push("/");
                  }}
                >
                  Logout
                </button>
              </li>
            </>
          ) : !isLoading ? (
            <>
              {authNavItems.map(({ href, label }) => (
                <li key={href}>
                  <Link href={href} className={pathname === href ? "active" : ""}>
                    {label}
                  </Link>
                </li>
              ))}
            </>
          ) : null}
        </ul>
      </div>
    </nav>
  );
}
