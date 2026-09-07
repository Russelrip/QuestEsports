"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { getProviderLinkUrl } from "@/lib/account-linking";

// Discord carries match communication now, so an account without one is
// unreachable the moment it matters. Rather than let a player discover that at
// the point of registering, a signed-in session with no linked Discord is held
// here until it has one.
//
// This is the visible half of the requirement. The server refuses the same
// writes independently (see requireDiscordLinked), because a gate that lives
// only in the client is a suggestion to anyone willing to call the API
// directly.
//
// The connect action is rendered here rather than linked to, so the gate is
// never a dead end: there is no page a held session has to reach first.
const EXEMPT_PREFIXES = [
  // Signing in, signing up and account recovery all have to work before there
  // is a linked account to check.
  "/login",
  "/signup",
  "/join",
  "/forgot-password",
  "/reset-password",
  "/confirm-email-change",
  // Linked accounts are managed here, so holding it would strand anyone who
  // wants to review their connections.
  "/profile",
  // Staff reach each other through the server's own role structure, and an
  // operator locked out of the dashboard cannot investigate the lockout.
  "/admin",
  "/maintenance",
];

const isExempt = (pathname: string | null) =>
  Boolean(pathname) &&
  EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname?.startsWith(`${prefix}/`),
  );

export default function DiscordConnectionGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();

  const held =
    !isLoading &&
    Boolean(user) &&
    user?.role !== "admin" &&
    !user?.discordId &&
    !isExempt(pathname);

  if (!held) {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col justify-center px-6 py-16">
      <div className="rounded-[22px] border border-white/10 bg-black/30 p-8">
        <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">
          One step left
        </p>
        <h1 className="mt-3 text-2xl text-white">Connect your Discord account</h1>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          Quest runs match communication through Discord — scheduling, rosters,
          results and anything a referee needs to reach you about. Connecting it
          once links your account to the handle staff will actually use.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          Your handle comes from the connection itself, so there is nothing to
          type and nothing to keep up to date if you change your Discord name.
        </p>
        <Button
          className="mt-6 w-full"
          onClick={() => window.location.assign(getProviderLinkUrl("discord"))}
        >
          Connect Discord
        </Button>
      </div>
    </div>
  );
}
