"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  fetchTeamInvitePreview,
  respondToTeamInvite,
  type TeamInvitePreview,
} from "@/lib/teams";

export default function TeamInviteContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [status, setStatus] = useState<"loading" | "ready" | "success" | "error">(
    "loading"
  );
  const [message, setMessage] = useState("Loading your team invite...");
  const [invite, setInvite] = useState<TeamInvitePreview | null>(null);
  const [submitting, setSubmitting] = useState<"" | "accept" | "decline">("");

  useEffect(() => {
    let cancelled = false;

    const loadInvite = async () => {
      if (!token) {
        setStatus("error");
        setMessage("Team invite token is missing.");
        return;
      }

      try {
        const nextInvite = await fetchTeamInvitePreview(token);

        if (cancelled) {
          return;
        }

        setInvite(nextInvite);
        if (nextInvite.inviteStatus === "pending") {
          setStatus("ready");
          setMessage("Review this team invite and choose whether to join.");
          return;
        }

        setStatus("success");
        setMessage(
          nextInvite.inviteStatus === "accepted"
            ? "This invite has already been accepted."
            : "This invite has already been declined."
        );
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setMessage(
          requestError instanceof Error
            ? requestError.message
            : "Could not load this team invite."
        );
      }
    };

    void loadInvite();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleDecision = async (decision: "accept" | "decline") => {
    try {
      setSubmitting(decision);
      const response = await respondToTeamInvite(token, decision);
      setInvite(response.invite);
      setStatus("success");
      setMessage(response.message);
    } catch (requestError) {
      setStatus("error");
      setMessage(
        requestError instanceof Error
          ? requestError.message
          : "Could not update this team invite."
      );
    } finally {
      setSubmitting("");
    }
  };

  return (
    <section className="login-section">
      <div className="form-container login-container">
        <div className="login-box">
          <h2>Team Invitation</h2>

          <div
            className={`auth-callout ${
              status === "success" ? "auth-callout-success" : "auth-callout-warning"
            }`}
          >
            <p>{message}</p>
          </div>

          {invite ? (
            <div className="team-invite-summary">
              <p>
                <span>Player</span>
                {invite.memberName}
              </p>
              <p>
                <span>Team</span>
                {invite.team.name}
              </p>
              <p>
                <span>Captain</span>
                {invite.team.captainName}
              </p>
              <p>
                <span>Email</span>
                {invite.email}
              </p>
            </div>
          ) : null}

          {status === "ready" ? (
            <div className="auth-inline-actions">
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={Boolean(submitting)}
                onClick={() => void handleDecision("accept")}
              >
                {submitting === "accept" ? "Accepting..." : "Accept Invite"}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={Boolean(submitting)}
                onClick={() => void handleDecision("decline")}
              >
                {submitting === "decline" ? "Declining..." : "Decline"}
              </button>
            </div>
          ) : null}

          {status !== "loading" ? (
            <div className="auth-inline-actions">
              <Link href="/profile" className="btn btn-secondary btn-small">
                Open Profile
              </Link>
              <Link href="/login" className="btn btn-primary btn-small">
                Go to Login
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
