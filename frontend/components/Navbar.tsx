"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import UserMenu from "@/components/UserMenu";
import { Button, buttonClassName } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { useAuth } from "@/components/auth/AuthProvider";
import { useUiStore } from "@/hooks/useUiStore";
import { cn, getInitials } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/media";
import { authNavItems, primaryNavItems, secondaryNavItems } from "@/lib/site";
import NotificationBell from "@/components/notifications/NotificationBell";
import { NavIcon } from "@/components/ui/icon";

const isNavItemActive = (pathname: string, href: string) =>
  href === "/"
    ? pathname === href
    : pathname === href ||
      pathname.startsWith(`${href}/`) ||
      // Tickets has no header slot of its own yet, so it borrows this one.
      // Remove once the header restructure gives it a real entry.
      (href === "/tournaments" && pathname.startsWith("/tickets"));

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const { mobileNavOpen, setMobileNavOpen, toggleMobileNav } = useUiStore();
  const avatarUrl = resolveImageUrl(user?.avatarUrl);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }

    const root = document.documentElement;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const previousOverflow = root.style.overflow;
    const previousOverscrollBehavior = root.style.overscrollBehavior;
    const previousScrollBehavior = root.style.scrollBehavior;

    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    root.style.scrollBehavior = "auto";

    // Some mobile browsers reset the root scroll position when scrolling is
    // locked. Keep the menu beside the viewport where it was opened.
    const restoreFrame = window.requestAnimationFrame(() => {
      if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
        window.scrollTo(scrollX, scrollY);
      }
    });

    return () => {
      window.cancelAnimationFrame(restoreFrame);
      root.style.overflow = previousOverflow;
      root.style.overscrollBehavior = previousOverscrollBehavior;
      if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
        window.scrollTo(scrollX, scrollY);
      }
      root.style.scrollBehavior = previousScrollBehavior;
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
                  prefetch={false}
                  onMouseEnter={() => router.prefetch(item.href)}
                  onFocus={() => router.prefetch(item.href)}
                  className={cn(
                    "px-1 py-2 text-sm font-medium text-slate-400 transition-colors duration-200 hover:text-white",
                    isNavItemActive(pathname, item.href) && "text-white"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </div>

            <div className="flex min-w-0 items-center justify-start lg:justify-self-center">
              <Link
                href="/"
                prefetch={false}
                onMouseEnter={() => router.prefetch("/")}
                onFocus={() => router.prefetch("/")}
                className="flex items-center"
                aria-label="Quest home"
              >
                <Image
                  src="/images/logo.png"
                  alt=""
                  width={48}
                  height={48}
                  priority
                  className="h-11 w-11 sm:h-12 sm:w-12"
                />
              </Link>
            </div>

            <div className="hidden items-center justify-end gap-6 lg:flex lg:justify-self-end xl:gap-8">
              {secondaryNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  onMouseEnter={() => router.prefetch(item.href)}
                  onFocus={() => router.prefetch(item.href)}
                  className={cn(
                    "px-1 py-2 text-sm font-medium text-slate-400 transition-colors duration-200 hover:text-white",
                    isNavItemActive(pathname, item.href) && "text-white"
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
                    prefetch={false}
                    onMouseEnter={() => router.prefetch(item.href)}
                    onFocus={() => router.prefetch(item.href)}
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
                    prefetch={false}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/8 hover:text-white",
                      isNavItemActive(pathname, item.href) && "bg-white/10 text-white"
                    )}
                  >
                    <NavIcon icon={item.icon} />
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-3 grid gap-2 border-t border-white/8 pt-3">
                {!isLoading && isAuthenticated && user ? (
                  <div className="grid gap-2">
                    <Link href="/profile" prefetch={false} className="flex items-center gap-3 rounded-2xl bg-white/6 px-4 py-3 text-sm text-white">
                      <span className="relative flex size-9 items-center justify-center overflow-hidden rounded-xl bg-violet-700 text-xs font-bold">{getInitials(user.firstName, user.lastName, user.username)}{avatarUrl ? <Image src={avatarUrl} alt="" width={36} height={36} unoptimized className="absolute h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}</span>
                      <span>
                        <span className="block font-semibold">{user.username}</span>
                        <span className="block text-xs text-slate-400">{user.emailVerified ? "Verified account" : "Verification pending"}</span>
                      </span>
                    </Link>
                    <NotificationBell user={user} compact />
                    {user.role === "admin" ? (
                      <Link href="/admin" prefetch={false} className="flex items-center gap-3 rounded-2xl bg-white/6 px-4 py-3 text-sm text-white">
                        <NavIcon icon="shield" />
                        Admin Panel
                      </Link>
                    ) : null}
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        if (await logout()) setMobileNavOpen(false);
                      }}
                    >
                      <NavIcon icon="logout" />
                      Logout
                    </Button>
                  </div>
                ) : !isLoading ? (
                  authNavItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={false}
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
