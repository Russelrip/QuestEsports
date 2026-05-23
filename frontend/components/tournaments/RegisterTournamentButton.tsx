"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
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
  closedAsButton = false,
}: {
  tournament: Tournament;
  className?: string;
  closedAsButton?: boolean;
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
        const response = await apiFetch(`/api/tournament-registration/status/${tournament.slug}`);
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Failed to check registration status.");
        }

        if (!cancelled) {
          setStatus(data.isRegistered ? "registered" : "ready");
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Could not verify registration status.");
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
    if (closedAsButton) {
      return (
        <Button type="button" variant="secondary" disabled className={className}>
          {getTournamentRegistrationLabel(tournament)}
        </Button>
      );
    }

    return <Badge className={className}>{getTournamentRegistrationLabel(tournament)}</Badge>;
  }

  const isRegistered = status === "registered";
  const isChecking = status === "loading";

  return (
    <div className={className}>
      <Button
        type="button"
        variant={isRegistered ? "secondary" : "primary"}
        disabled={isRegistered || isChecking}
        onClick={() => {
          const registrationPath = `/tournament-registration?tournament=${tournament.slug}`;
          const destination = user ? registrationPath : `/login?redirect=${encodeURIComponent(registrationPath)}`;
          router.push(destination);
        }}
      >
        {isRegistered ? "Registered" : isChecking ? "Checking..." : "Register Now"}
      </Button>
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
