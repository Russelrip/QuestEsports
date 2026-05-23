"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import UserMenu from "@/components/UserMenu";
import { Button, buttonClassName } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { useAuth } from "@/components/auth/AuthProvider";
import { useUiStore } from "@/hooks/useUiStore";
import { cn } from "@/lib/utils";
import { authNavItems, primaryNavItems } from "@/lib/site";

export default function Navbar() {
  const pathname = usePathname();
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const { mobileNavOpen, setMobileNavOpen, toggleMobileNav } = useUiStore();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-[rgba(5,3,11,0.82)] backdrop-blur-xl">
      <Container className="py-3 sm:py-4">
        <div className="rounded-[28px] border border-white/10 bg-white/5 px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.25)] sm:px-6 lg:px-8">
          <div className="flex min-h-12 items-center lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:gap-8">
            <div className="flex min-w-0 items-center justify-start">
              <Link href="/" className="flex items-center gap-3 sm:gap-4">
                <div className="rounded-2xl border border-white/10 bg-black/30 p-1.5 sm:p-2">
                  <Image
                    src="/images/logo-header.png"
                    alt="Quest Esports"
                    width={48}
                    height={48}
                    priority
                    className="h-11 w-11 sm:h-12 sm:w-12"
                  />
                </div>
                <div className="hidden min-w-0 sm:block">
                  <p className="font-display text-base tracking-[0.24em] text-white">QUEST</p>
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Esports Platform</p>
                </div>
              </Link>
            </div>

            <nav className="hidden items-center justify-center gap-8 xl:gap-10 lg:flex">
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
            </nav>

            <div className="hidden items-center justify-end gap-4 lg:flex">
              {!isLoading && isAuthenticated && user ? (
                <UserMenu user={user} logout={logout} isAdmin={user.role === "admin"} />
              ) : !isLoading ? (
                authNavItems.map((item, index) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={buttonClassName({
                      variant: index === 0 ? "ghost" : "primary",
                      size: "sm",
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

        <AnimatePresence>
          {mobileNavOpen ? (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-3 rounded-[28px] border border-white/10 bg-[rgba(12,12,20,0.92)] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.35)] lg:hidden"
            >
              <nav className="grid gap-2">
                {primaryNavItems.map((item) => (
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
                    <Link href="/profile" className="rounded-2xl bg-white/6 px-4 py-3 text-sm text-white">
                      {user.username}
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
                  authNavItems.map((item, index) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={buttonClassName({
                        variant: index === 0 ? "ghost" : "primary",
                        className: "w-full",
                      })}
                    >
                      {item.label}
                    </Link>
                  ))
                ) : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Container>
    </header>
  );
}
