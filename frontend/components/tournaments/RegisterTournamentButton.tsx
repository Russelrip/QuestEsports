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
import { unmarkTournamentRegistered } from "@/lib/registered-tournaments";

type RegistrationStatus = "loading" | "ready" | "registered";

type ExistingRegistration = {
  status: "pending" | "approved" | "rejected";
  paymentStatus: "unpaid" | "pending" | "paid";
  reservedUntil?: string | null;
  assignedSlotNumber?: number | null;
  payment?: {
    orderId: string;
    provider: string;
    status: string;
  } | null;
};

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
  const [registration, setRegistration] = useState<ExistingRegistration | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canRegisterForTournament(tournament) && tournament.paymentMethod !== "bank_transfer") {
      return;
    }

    let cancelled = false;

    const syncRegistrationState = async () => {
      setError("");

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
        const response = await apiFetch(`/api/tournaments/${tournament.slug}/registration-status`);
        const data = (await response.json()) as {
          success?: boolean;
          message?: string;
          isRegistered?: boolean;
          registration?: ExistingRegistration | null;
        };

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Failed to check registration status.");
        }

        if (!cancelled) {
          const registered = Boolean(data.isRegistered);

          if (!registered) {
            unmarkTournamentRegistered(tournament.slug);
          }

          setRegistration(data.registration || null);
          setStatus(registered ? "registered" : "ready");
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

  const isRegistered = status === "registered";
  const isChecking = status === "loading";
  const pendingBankTransfer = isRegistered &&
    registration?.payment?.provider === "bank_transfer" &&
    registration.payment.status !== "paid" &&
    Boolean(registration.payment.orderId);
  const slotLabel = registration?.assignedSlotNumber
    ? `Slot #${registration.assignedSlotNumber}`
    : null;

  if (!canRegisterForTournament(tournament) && !pendingBankTransfer) {
    if (closedAsButton) {
      return (
        <Button type="button" variant="secondary" disabled className={className}>
          {getTournamentRegistrationLabel(tournament)}
        </Button>
      );
    }

    return <Badge className={className}>{getTournamentRegistrationLabel(tournament)}</Badge>;
  }

  if (!tournament.registrationPaymentAvailable) {
    return (
      <div className={className}>
        <Button type="button" variant="secondary" disabled>
          Online payment unavailable
        </Button>
        <p className="mt-2 text-xs text-slate-400">
          Quest will open paid registration after payment setup is complete.
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <Button
        type="button"
        variant={isRegistered && !pendingBankTransfer ? "secondary" : "primary"}
        disabled={(isRegistered && !pendingBankTransfer) || isChecking}
        onClick={() => {
          if (pendingBankTransfer && registration?.payment?.orderId) {
            router.push(`/tournaments/${tournament.slug}/payment?order=${encodeURIComponent(registration.payment.orderId)}`);
            return;
          }
          const registrationPath = `/tournaments/${tournament.slug}/register`;
          const destination = user ? registrationPath : `/login?redirect=${encodeURIComponent(registrationPath)}`;
          router.push(destination);
        }}
      >
        {pendingBankTransfer
          ? "Open Bank Transfer Details"
          : isRegistered
          ? slotLabel ? `Registered · ${slotLabel}` : "Registered"
          : isChecking
            ? "Checking..."
            : tournament.registrationMode === "slot_based"
              ? "Reserve Slot"
              : "Register Now"}
      </Button>
      {pendingBankTransfer ? (
        <p className="mt-2 max-w-sm text-xs leading-5 text-amber-100">
          {slotLabel ? `${slotLabel} is reserved. ` : "Your slot is reserved. "}
          Complete the transfer and upload your receipt
          {registration?.reservedUntil ? ` before ${new Date(registration.reservedUntil).toLocaleString()}.` : "."}
        </p>
      ) : isRegistered ? (
        <p className="mt-2 text-xs text-emerald-200">Your registration was received. You can track it from your profile.</p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
