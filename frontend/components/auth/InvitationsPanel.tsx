"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToastStore } from "@/hooks/useToastStore";
import { getProviderLinkUrl } from "@/lib/account-linking";
import { invitationsPath } from "@/lib/team-invite-links";
import {
  fetchMyInvitations,
  respondToInvitation,
  type InvitationReadiness,
  type InvitationReference,
  type TeamInvitation,
} from "@/lib/teams";

// Where an invitation is answered.
//
// It used to be answered at the end of an emailed link, which made a roster
// spot exactly as durable as the delivery: an email that never arrived was a
// spot nobody could take. The invitation is a row now, found by signing in, and
// this is the page that shows it.
//
// Accepting requires a connected Discord account. That requirement used to be
// checked when the captain submitted the roster, where it could not be
// satisfied — a captain cannot connect Discord for somebody else. Here it can
// be, so the refusal comes with the fix attached rather than an explanation of
// why someone else was blocked.

const ROLE_LABELS: Record<string, string> = {
  PLAYER: "Player",
  SUBSTITUTE: "Substitute",
  COACH: "Coach",
  CAPTAIN: "Captain",
};

const formatDeadline = (expiresAt: string | null) => {
  if (!expiresAt) return null;
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(remainingMs)) return null;
  if (remainingMs <= 0) return "Expired";
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  if (hours < 1) return "Expires within the hour";
  if (hours < 24) return `Expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
};

// What to say about the reference a captain's link carried. Every one of these
// is about the link, never about the invitation behind it: `mismatch` in
// particular says only that this account cannot reach it — not whose it is, not
// which team, not the address it was sent to.
type ReferenceNotice = { title: string; body: string };

// What to say about the reference a captain's link carried.
//
// `mismatch` means only that the reference could not be matched to this
// account. That is usually the wrong address — but not always: a reference goes
// stale whenever the row it names is replaced, which is what happens when a
// captain corrects a member's email or removes and re-adds them. The person
// following that link may be signed in as exactly the right account and have a
// perfectly good invitation waiting.
//
// So the answer depends on what else is on the page. Telling somebody to go and
// sign in as somebody else, directly above the invitation they came here to
// accept, sends them away from the thing that was working.
const referenceNoticeFor = (
  state: string,
  hasInvitations: boolean
): ReferenceNotice | undefined => {
  if (state === "mismatch") {
    return hasInvitations
      ? {
          title: "That link is out of date",
          body: "It points at an invitation that has since been replaced — usually because your captain corrected the email or re-added you. Your current invitations are below.",
        }
      : {
          title: "This invitation is not for this account",
          body: "Invitations are attached to the email address they were sent to. Sign out and sign in with the exact address your captain invited, or ask them which one they used.",
        };
  }
  if (state === "answered") {
    return {
      title: "You have already answered this invitation",
      body: "Nothing further is needed. If you meant to change your answer, ask your captain to invite you again.",
    };
  }
  if (state === "expired") {
    return {
      title: "This invitation ran out",
      body: "Invitations are open for 72 hours. Ask your captain to send it again and it will reopen for another 72.",
    };
  }
  return undefined;
};

export function InvitationsPanel({ memberReference = null }: { memberReference?: string | null }) {
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [readiness, setReadiness] = useState<InvitationReadiness | null>(null);
  const [reference, setReference] = useState<InvitationReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const showToast = useToastStore((state) => state.showToast);
  const focusedRef = useRef<HTMLLIElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchMyInvitations(memberReference);
      setInvitations(result.invitations);
      setReadiness(result.readiness);
      setReference(result.reference);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load your invitations.");
    } finally {
      setLoading(false);
    }
  }, [memberReference]);

  useEffect(() => {
    void load();
  }, [load]);

  // Somebody who followed a link to one invitation should not have to find it
  // among the others. It is scrolled to, never auto-answered.
  useEffect(() => {
    if (loading || reference?.state !== "waiting") return;
    focusedRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [loading, reference]);

  const respond = async (invitation: TeamInvitation, decision: "accept" | "decline") => {
    setRespondingId(invitation.id);
    try {
      const result = await respondToInvitation(invitation.id, decision);
      showToast({
        tone: "success",
        title: decision === "accept" ? "Invitation accepted" : "Invitation declined",
        description: result.message,
      });
      setInvitations((current) => current.filter((entry) => entry.id !== invitation.id));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Could not answer this invitation.";
      // The one refusal with an action behind it. Re-reading readiness rather
      // than trusting the click keeps the panel honest if they connected
      // Discord in another tab.
      showToast({ tone: "error", title: "Could not answer this invitation", description: message });
      void load();
    } finally {
      setRespondingId(null);
    }
  };

  const needsDiscord = readiness ? !readiness.hasDiscord : false;
  // An unverified address matches no invitation, so it has to be reported as
  // itself. Told that the link was somebody else's, a player would go and ask
  // their captain to resend something that was never the problem.
  const needsVerification = readiness ? readiness.emailVerified === false : false;
  const referenceNotice =
    !needsVerification && reference
      ? referenceNoticeFor(reference.state, invitations.length > 0)
      : undefined;
  // Linking is a detour, so it has to come back. Without this the connect
  // button lands on the account tab and the invitation is a tab away again.
  const discordLinkUrl = getProviderLinkUrl("discord", invitationsPath(memberReference));

  if (loading) {
    return (
      <div className="border border-white/8 bg-[#11131c] p-6">
        <p className="text-sm text-slate-400">Loading your invitations…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5">
        <p className="text-[10px] uppercase tracking-[0.22em] text-purple-200/70">Waiting on you</p>
        <h3 className="mt-2 border-l-2 border-purple-300 pl-3 text-2xl text-white">Team Invitations</h3>
      </div>

      {error ? <p className="mb-4 text-sm text-rose-300">{error}</p> : null}

      {needsVerification ? (
        <div className="mb-5 border border-amber-300/25 bg-amber-300/5 p-5">
          <p className="text-sm font-semibold text-amber-100">Verify your email first</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            An invitation is addressed to an email address, and Quest will only match one to
            an address the account has proven it controls. Open the verification link we sent
            you, then come back — anything waiting for you will be here.
          </p>
        </div>
      ) : referenceNotice ? (
        <div className="mb-5 border border-amber-300/25 bg-amber-300/5 p-5">
          <p className="text-sm font-semibold text-amber-100">{referenceNotice.title}</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">{referenceNotice.body}</p>
        </div>
      ) : null}

      {needsDiscord && invitations.length > 0 ? (
        <div className="mb-5 border border-amber-300/25 bg-amber-300/5 p-5">
          <p className="text-sm font-semibold text-amber-100">
            Connect Discord before you can accept
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Quest runs scheduling, rosters and anything a referee needs to reach you about through
            Discord. Connecting it once links your account to the handle staff will actually use —
            there is nothing to type, and nothing to keep up to date if you change your name there.
          </p>
          <Button
            className="mt-4"
            onClick={() => window.location.assign(discordLinkUrl)}
          >
            Connect Discord
          </Button>
        </div>
      ) : null}

      {invitations.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-4 border border-dashed border-white/10 bg-[#11131c] p-6">
          <p className="text-sm text-slate-400">You have no invitations waiting.</p>
          <Link href="/tournaments" className="text-sm font-semibold text-purple-200 hover:text-white">
            Browse tournaments →
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4">
          {invitations.map((invitation) => {
            const deadline = formatDeadline(invitation.expiresAt);
            const busy = respondingId === invitation.id;
            const focused =
              reference?.state === "waiting" && reference.member === invitation.id;
            return (
              <li
                key={invitation.id}
                ref={focused ? focusedRef : undefined}
                className={
                  focused
                    ? "border border-purple-300/40 bg-[#151327] p-5 shadow-[0_0_0_1px_rgba(192,132,252,0.25)]"
                    : "border border-white/8 bg-[#11131c] p-5"
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg text-white">{invitation.teamName}</p>
                    <p className="mt-1 text-sm text-slate-400">
                      {invitation.captain ? `${invitation.captain} invited you` : "You were invited"}
                      {invitation.tournamentTitle ? ` for ${invitation.tournamentTitle}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{ROLE_LABELS[invitation.role] || invitation.role}</Badge>
                    {invitation.teamTag ? <Badge>{invitation.teamTag}</Badge> : null}
                  </div>
                </div>

                {deadline ? (
                  <p className="mt-3 text-xs uppercase tracking-[0.14em] text-amber-200/80">{deadline}</p>
                ) : null}

                <div className="mt-5 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    disabled={busy || needsDiscord}
                    onClick={() => void respond(invitation, "accept")}
                  >
                    {busy ? "Saving…" : needsDiscord ? "Connect Discord to accept" : "Accept"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void respond(invitation, "decline")}
                  >
                    Decline
                  </Button>
                  {invitation.tournamentSlug ? (
                    <Link
                      href={`/tournaments/${invitation.tournamentSlug}`}
                      className="self-center text-sm font-semibold text-purple-200 hover:text-white"
                    >
                      View tournament →
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
