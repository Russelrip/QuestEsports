"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToastStore } from "@/hooks/useToastStore";
import { getProviderLinkUrl } from "@/lib/account-linking";
import {
  fetchMyInvitations,
  respondToInvitation,
  type InvitationReadiness,
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

export function InvitationsPanel() {
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [readiness, setReadiness] = useState<InvitationReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const showToast = useToastStore((state) => state.showToast);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchMyInvitations();
      setInvitations(result.invitations);
      setReadiness(result.readiness);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load your invitations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
            onClick={() => window.location.assign(getProviderLinkUrl("discord"))}
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
            return (
              <li key={invitation.id} className="border border-white/8 bg-[#11131c] p-5">
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
