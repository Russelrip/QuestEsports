"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import AuthPanel from "@/components/auth/AuthPanel";
import { useAuth } from "@/components/auth/AuthProvider";
import { buttonClassName } from "@/components/ui/button";
import { INVITATIONS_PATH } from "@/lib/team-invite-links";

// The signed-out half of a captain's invitation link.
//
// Everything on this page is generic, and there is nothing in the link to make
// it otherwise: no team, no captain, no address, and no reference to a
// particular invitation. These links get forwarded, so holding one you were not
// the intended reader of must reveal nothing — and must not tell you anything
// about an invitation either, including that it exists.
//
// Signing in is not what grants anything. The invitations someone sees are the
// ones addressed to the account they signed in as, which is the whole rule.
export default function TeamInviteOnboarding() {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const destination = INVITATIONS_PATH;

  // Somebody already signed in has no use for onboarding instructions. Replaced
  // rather than pushed so that Back does not drop them here again.
  useEffect(() => {
    if (!isLoading && user) router.replace(destination);
  }, [destination, isLoading, router, user]);

  if (isLoading || user) {
    return (
      <AuthPanel
        title="Team Invitation"
        description="Opening your invitations…"
      >
        <p className="text-center text-sm text-slate-400">One moment.</p>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      title="You have been invited to a team"
      description="Your captain added you to their Quest roster. Sign in to accept it."
    >
      <div className="grid gap-6">
        <div className="rounded-[20px] border border-purple-300/20 bg-purple-400/[0.06] p-5">
          <h3 className="text-lg font-semibold text-white">
            Sign in with the email you were invited on
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            The invitation is attached to a specific email address. Quest shows it to the
            account that owns that address and to no one else, so use the address your
            captain invited — a different one will not find it, however you got here.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href={`/login?redirect=${encodeURIComponent(destination)}`}
            className={buttonClassName({})}
          >
            Sign in
          </Link>
          <Link
            href={`/signup?redirect=${encodeURIComponent(destination)}`}
            className={buttonClassName({ variant: "secondary" })}
          >
            Create account
          </Link>
        </div>

        <ol className="grid gap-3 border-t border-white/10 pt-5 text-sm leading-6 text-slate-400">
          <li>
            <span className="font-semibold text-slate-200">1.</span> Sign in, or create an
            account using the invited email address.
          </li>
          <li>
            <span className="font-semibold text-slate-200">2.</span> Verify that address if
            you have just created the account. An unverified address matches nothing.
          </li>
          <li>
            <span className="font-semibold text-slate-200">3.</span> Connect Discord. Quest
            runs scheduling and anything a referee needs to reach you about through it, so
            accepting a roster spot requires it.
          </li>
          <li>
            <span className="font-semibold text-slate-200">4.</span> Accept from your
            invitations. It waits there until you answer it or it runs out — if it has
            already run out, ask your captain to send it again.
          </li>
        </ol>

        <p className="text-sm text-slate-500">
          Not expecting this? Nothing happens until you accept, and you can ignore it.
        </p>
      </div>
    </AuthPanel>
  );
}
