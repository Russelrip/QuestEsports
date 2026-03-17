"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AuthUser } from "@/lib/auth";

type UserMenuProps = {
  user: AuthUser;
  logout: () => Promise<void>;
  onNavigate?: () => void;
  isAdmin?: boolean;
};

export default function UserMenu({
  user,
  logout,
  onNavigate,
  isAdmin = false,
}: UserMenuProps) {
  const pathname = usePathname();
  const router = useRouter();
  const menuRef = useRef<HTMLLIElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const initials = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`
    .trim()
    .toUpperCase() || user.username.slice(0, 2).toUpperCase();

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <li
      ref={menuRef}
      className={`nav-user-menu ${isOpen ? "open" : ""}`}
    >
      <button
        type="button"
        className={`nav-user-trigger ${pathname === "/profile" ? "active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="nav-user-avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="nav-user-name">{user.username}</span>
        <span className="nav-user-chevron" aria-hidden="true">
          ^
        </span>
      </button>

      {isOpen && (
        <div className="nav-user-dropdown" role="menu" aria-label="User menu">
          <p className="nav-user-dropdown-status">
            Logged in as <strong>{user.username}</strong>
          </p>
          <Link
            href="/profile"
            className="nav-user-dropdown-link"
            role="menuitem"
            onClick={() => {
              setIsOpen(false);
              onNavigate?.();
            }}
          >
            Profile
          </Link>
          {isAdmin ? (
            <Link
              href="/admin"
              className="nav-user-dropdown-link"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onNavigate?.();
              }}
            >
              Admin Panel
            </Link>
          ) : null}
          <button
            type="button"
            className="nav-user-dropdown-button"
            role="menuitem"
            onClick={async () => {
              setIsOpen(false);
              onNavigate?.();
              await logout();
              router.push("/");
            }}
          >
            Logout
          </button>
        </div>
      )}
    </li>
  );
}
