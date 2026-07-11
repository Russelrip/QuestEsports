"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AuthPanel from "@/components/auth/AuthPanel";
import { useAuth } from "@/components/auth/AuthProvider";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { useTeamInvite } from "@/hooks/api/useTeams";
import { respondToTeamInvite } from "@/lib/teams";

export default function TeamInviteContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const { user, isLoading: authLoading, logout } = useAuth();
  const [status, setStatus] = useState<"ready" | "success" | "error">("ready");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState<"" | "accept" | "decline">("");
  const { data: invite, loading, error, setData: setInvite } = useTeamInvite(token);
  const invitePath = `/team-invite?token=${encodeURIComponent(token)}`;
  const loginPath = `/login?redirect=${encodeURIComponent(invitePath)}`;
  const signupPath = invite
    ? `/signup?redirect=${encodeURIComponent(invitePath)}&email=${encodeURIComponent(invite.email)}`
    : `/signup?redirect=${encodeURIComponent(invitePath)}`;
  const accountMatchesInvite =
    Boolean(user && invite) &&
    user?.email.trim().toLowerCase() === invite?.email.trim().toLowerCase();

  const inviteStatus = invite?.inviteStatus;
  const resolvedStatus =
    status === "success" || status === "error"
      ? status
      : inviteStatus && inviteStatus !== "pending"
        ? "success"
        : "ready";
  const resolvedMessage =
    message ||
    (!token
      ? "Team invite token is missing."
      : error
        ? error
        : inviteStatus === "accepted"
          ? "This invite has already been accepted."
          : inviteStatus === "declined"
            ? "This invite has already been declined."
            : "Review this team invite and choose whether to join.");

  const handleDecision = async (decision: "accept" | "decline") => {
    try {
      setSubmitting(decision);
      const response = await respondToTeamInvite(token, decision);
      setInvite(response.invite);
      setStatus("success");
      setMessage(response.message);
    } catch (nextError) {
      setStatus("error");
      setMessage(nextError instanceof Error ? nextError.message : "Could not update this team invite.");
    } finally {
      setSubmitting("");
    }
  };

  return (
    <AuthPanel
      title="Team Invitation"
      description="Confirm whether you're joining the roster before the team locks in tournament registration."
    >
      <div className="grid gap-5">
        {loading ? (
          <LoadingState title="Loading invite" description="Fetching the roster invitation details." />
        ) : (
          <div
            className={`rounded-[24px] p-5 text-sm ${
              resolvedStatus === "success"
                ? "border border-emerald-300/20 bg-emerald-400/8 text-slate-100"
                : "border border-amber-300/20 bg-amber-400/8 text-slate-100"
            }`}
          >
            {resolvedMessage}
          </div>
        )}

        {invite ? (
          <div className="grid gap-3 rounded-[24px] border border-white/8 bg-white/5 p-5 text-sm text-slate-300">
            <div className="flex items-center justify-between gap-3">
              <span>Invite Status</span>
              <Badge>{invite.inviteStatus}</Badge>
            </div>
            <p>
              <span className="text-slate-500">Player:</span> {invite.memberName}
            </p>
            <p>
              <span className="text-slate-500">Team:</span> {invite.team.name}
            </p>
            {invite.team.tournamentTitle ? (
              <p>
                <span className="text-slate-500">Tournament:</span> {invite.team.tournamentTitle}
              </p>
            ) : null}
            <p>
              <span className="text-slate-500">Captain:</span> {invite.team.captainName}
            </p>
            <p>
              <span className="text-slate-500">Email:</span> {invite.email}
            </p>
          </div>
        ) : null}

        {invite && !authLoading && !user ? (
          <div className="grid gap-4 rounded-[24px] border border-amber-300/20 bg-amber-400/8 p-5 text-sm text-slate-200">
            <p>
              Create an account or sign in using <strong>{invite.email}</strong> before responding.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href={signupPath} className={buttonClassName({})}>
                Create Account
              </Link>
              <Link href={loginPath} className={buttonClassName({ variant: "secondary" })}>
                Sign In
              </Link>
            </div>
          </div>
        ) : null}

        {invite && user && !accountMatchesInvite ? (
          <div className="grid gap-4 rounded-[24px] border border-rose-300/20 bg-rose-400/8 p-5 text-sm text-slate-200">
            <p>
              You are signed in as <strong>{user.email}</strong>. Sign in with the invited address{" "}
              <strong>{invite.email}</strong> to respond.
            </p>
            <div>
              <Button type="button" variant="secondary" onClick={() => void logout()}>
                Sign Out
              </Button>
            </div>
          </div>
        ) : null}

        {invite && user && accountMatchesInvite && !user.emailVerified ? (
          <div className="grid gap-4 rounded-[24px] border border-amber-300/20 bg-amber-400/8 p-5 text-sm text-slate-200">
            <p>Verify your account email before accepting or declining this invitation.</p>
            <ResendVerificationButton email={user.email} />
          </div>
        ) : null}

        {resolvedStatus === "ready" && invite && user?.emailVerified && accountMatchesInvite ? (
          <div className="flex flex-wrap gap-3">
            <Button disabled={Boolean(submitting)} onClick={() => void handleDecision("accept")}>
              {submitting === "accept" ? "Accepting..." : "Accept Invite"}
            </Button>
            <Button
              variant="secondary"
              disabled={Boolean(submitting)}
              onClick={() => void handleDecision("decline")}
            >
              {submitting === "decline" ? "Declining..." : "Decline"}
            </Button>
          </div>
        ) : null}

        {!loading && user ? (
          <div className="flex flex-wrap gap-3">
            <Link href="/profile" className={buttonClassName({ variant: "secondary" })}>
              Open Profile
            </Link>
          </div>
        ) : null}
      </div>
    </AuthPanel>
  );
}
