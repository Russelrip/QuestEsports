"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch } from "@/lib/auth";
import {
  Tournament,
  canRegisterForTournament,
  getTournamentRegistrationLabel,
} from "@/lib/tournaments";
import { isTournamentRegisteredLocally } from "@/lib/registered-tournaments";

type RegistrationStatus = "loading" | "ready" | "registered";

export default function RegisterTournamentButton({
  tournament,
  className = "",
}: {
  tournament: Tournament;
  className?: string;
}) {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [status, setStatus] = useState<RegistrationStatus>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canRegisterForTournament(tournament)) {
      return;
    }

    let cancelled = false;

    const syncRegistrationState = async () => {
      setError("");

      if (isTournamentRegisteredLocally(tournament.slug)) {
        if (!cancelled) {
          setStatus("registered");
        }
        return;
      }

      if (authLoading) {
        setStatus("loading");
        return;
      }

      if (!user) {
        setStatus("ready");
        return;
      }

      try {
        setStatus("loading");
        const response = await apiFetch(
          `/api/tournament-registration/status/${tournament.slug}`
        );
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Failed to check registration status.");
        }

        if (!cancelled) {
          setStatus(data.isRegistered ? "registered" : "ready");
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Could not verify registration status."
          );
          setStatus("ready");
        }
      }
    };

    void syncRegistrationState();

    const handleRegistered = (event: Event) => {
      const customEvent = event as CustomEvent<{ slug?: string }>;
      if (customEvent.detail?.slug === tournament.slug) {
        setStatus("registered");
      }
    };

    window.addEventListener("quest:tournament-registered", handleRegistered);

    return () => {
      cancelled = true;
      window.removeEventListener("quest:tournament-registered", handleRegistered);
    };
  }, [authLoading, tournament, user]);

  if (!canRegisterForTournament(tournament)) {
    return (
      <div className={`tournament-register-cta ${className}`.trim()}>
        <span className="registration-closed-chip">
          {getTournamentRegistrationLabel(tournament)}
        </span>
      </div>
    );
  }

  const isRegistered = status === "registered";
  const isChecking = status === "loading";

  return (
    <div className={`tournament-register-cta ${className}`.trim()}>
      <button
        type="button"
        className={`btn ${isRegistered ? "btn-secondary is-disabled" : "btn-primary"}`}
        disabled={isRegistered || isChecking}
        aria-disabled={isRegistered || isChecking}
        onClick={() =>
          router.push(`/tournament-registration?tournament=${tournament.slug}`)
        }
      >
        {isRegistered ? "Registered" : isChecking ? "Checking..." : "Register Now"}
      </button>

      {error ? <p className="registration-status-note">{error}</p> : null}
    </div>
  );
}
