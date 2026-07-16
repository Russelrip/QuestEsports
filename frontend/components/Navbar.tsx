"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import UserMenu from "@/components/UserMenu";
import { Button, buttonClassName } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { useAuth } from "@/components/auth/AuthProvider";
import { useUiStore } from "@/hooks/useUiStore";
import { cn, getInitials } from "@/lib/utils";
import { buildApiUrl } from "@/lib/api";
import { authNavItems, primaryNavItems, secondaryNavItems } from "@/lib/site";

export default function Navbar() {
  const pathname = usePathname();
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const { mobileNavOpen, setMobileNavOpen, toggleMobileNav } = useUiStore();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-[rgba(5,3,11,0.96)] sm:bg-[rgba(5,3,11,0.82)] sm:backdrop-blur-xl">
      <Container className="relative py-2 sm:py-3">
        <div className="px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-h-12 items-center lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:gap-8">
            <div className="hidden items-center gap-7 lg:flex lg:justify-self-start xl:gap-10">
              {primaryNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-1 py-2 text-sm font-medium text-slate-400 transition-colors duration-200 hover:text-white",
                    pathname === item.href && "text-white"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>

            <div className="flex min-w-0 items-center justify-start lg:justify-self-center">
              <Link
                href="/"
                className="flex flex-col items-center gap-1"
                aria-label="Quest home"
              >
                <Image
                  src="/images/logo.png"
                  alt=""
                  width={48}
                  height={48}
                  priority
                  className="h-10 w-10 sm:h-11 sm:w-11"
                />
                <span className="pl-[0.22em] font-display text-[10px] leading-none tracking-[0.22em] text-white sm:text-xs">
                  QUEST
                </span>
              </Link>
            </div>

            <div className="hidden items-center justify-end gap-6 lg:flex lg:justify-self-end xl:gap-8">
              {secondaryNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "px-1 py-2 text-sm font-medium text-slate-400 transition-colors duration-200 hover:text-white",
                    pathname === item.href && "text-white"
                  )}
                >
                  {item.label}
                </Link>
              ))}
              {!isLoading && isAuthenticated && user ? (
                <UserMenu user={user} logout={logout} isAdmin={user.role === "admin"} />
              ) : !isLoading ? (
                authNavItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={buttonClassName({
                      variant: "ghost",
                      size: "sm",
                      className: "auth-nav-action",
                    })}
                  >
                    {item.label}
                  </Link>
                ))
              ) : (
                <div className="h-10 w-32 animate-pulse rounded-2xl bg-white/8" />
              )}
            </div>

            <button
              type="button"
              className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/6 lg:hidden"
              onClick={toggleMobileNav}
              aria-expanded={mobileNavOpen}
              aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            >
              <span className="sr-only">Menu</span>
              <div className="flex flex-col gap-1.5">
                <span className={cn("h-0.5 w-5 rounded-full bg-white transition", mobileNavOpen && "translate-y-2 rotate-45")} />
                <span className={cn("h-0.5 w-5 rounded-full bg-white transition", mobileNavOpen && "opacity-0")} />
                <span className={cn("h-0.5 w-5 rounded-full bg-white transition", mobileNavOpen && "-translate-y-2 -rotate-45")} />
              </div>
            </button>
          </div>
        </div>

        {mobileNavOpen ? (
            <div className="menu-enter absolute inset-x-4 top-full mt-2 max-h-[calc(100svh-6rem)] overflow-y-auto overscroll-contain rounded-[24px] border border-white/10 bg-[#0c0c14] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.4)] lg:hidden">
              <nav className="grid gap-2">
                {[...primaryNavItems, ...secondaryNavItems].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "rounded-2xl px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/8 hover:text-white",
                      pathname === item.href && "bg-white/10 text-white"
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-3 grid gap-2 border-t border-white/8 pt-3">
                {!isLoading && isAuthenticated && user ? (
                  <div className="grid gap-2">
                    <Link href="/profile" className="flex items-center gap-3 rounded-2xl bg-white/6 px-4 py-3 text-sm text-white">
                      <span className="flex size-9 items-center justify-center overflow-hidden rounded-xl bg-violet-700 text-xs font-bold">{user.avatarUrl ? <Image src={buildApiUrl(user.avatarUrl)} alt="" width={36} height={36} className="h-full w-full object-cover" /> : getInitials(user.firstName, user.lastName, user.username)}</span>{user.username}
                    </Link>
                    {user.role === "admin" ? (
                      <Link href="/admin" className="rounded-2xl bg-white/6 px-4 py-3 text-sm text-white">
                        Admin Panel
                      </Link>
                    ) : null}
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        await logout();
                        setMobileNavOpen(false);
                      }}
                    >
                      Logout
                    </Button>
                  </div>
                ) : !isLoading ? (
                  authNavItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={buttonClassName({
                        variant: "ghost",
                        className: "auth-nav-action w-full",
                      })}
                    >
                      {item.label}
                    </Link>
                  ))
                ) : null}
              </div>
            </div>
        ) : null}
      </Container>
    </header>
  );
}
