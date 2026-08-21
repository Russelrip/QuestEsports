"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, buttonClassName } from "@/components/ui/button";
import ReservationCountdown from "@/components/payments/ReservationCountdown";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch } from "@/lib/auth";
import { readApiResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  type Tournament,
  type PersonalRegistrationState,
  canRegisterForTournament,
  getRegistrationButtonLabel,
  getTournamentRegistrationLabel,
} from "@/lib/tournaments";
import { unmarkTournamentRegistered } from "@/lib/registered-tournaments";

type ExistingRegistration = {
  status: "pending" | "approved" | "rejected" | "waitlisted";
  paymentStatus: "unpaid" | "pending" | "paid";
  verificationStatus: "pending" | "verified" | "flagged";
  pendingInviteCount: number;
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
  const [status, setStatus] = useState<PersonalRegistrationState>("loading");
  const [registration, setRegistration] = useState<ExistingRegistration | null>(null);
  const [error, setError] = useState("");
  const [deadlineReached, setDeadlineReached] = useState(false);

  useEffect(() => {
    if (
      !canRegisterForTournament(tournament) &&
      !["bank_transfer", "payhere"].includes(tournament.paymentMethod)
    ) {
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
        const data = await readApiResponse<{
          success?: boolean;
          message?: string;
          isRegistered?: boolean;
          registration?: ExistingRegistration | null;
        }>(response, "Failed to check registration status.");

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Failed to check registration status.");
        }

        if (!cancelled) {
          const registered = Boolean(data.isRegistered);

          if (!registered) {
            unmarkTournamentRegistered(tournament.slug);
          }

          setRegistration(data.registration || null);
          setDeadlineReached(data.registration?.payment?.status === "expired");
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
  const expiredPayment = isRegistered && (
    registration?.payment?.status === "expired" || deadlineReached
  );
  const pendingBankTransfer = isRegistered &&
    registration?.verificationStatus === "verified" &&
    registration?.payment?.provider === "bank_transfer" &&
    !["paid", "expired"].includes(registration.payment.status) &&
    Boolean(registration.payment.orderId);
  const pendingPayHere = isRegistered &&
    registration?.verificationStatus === "verified" &&
    registration?.payment?.provider === "payhere" &&
    !["paid", "expired"].includes(registration.payment.status);
  const awaitingRoster = isRegistered &&
    tournament.entryType === "team" &&
    registration?.verificationStatus !== "verified";
  const readyForPayment = isRegistered &&
    tournament.entryType === "team" &&
    registration?.verificationStatus === "verified" &&
    registration.paymentStatus === "unpaid" &&
    !expiredPayment;
  const hasPaymentAction = pendingBankTransfer || pendingPayHere || readyForPayment;
  const hasRegistrationAction = hasPaymentAction || awaitingRoster || expiredPayment;
  const slotLabel = registration?.assignedSlotNumber
    ? `Slot #${registration.assignedSlotNumber}`
    : null;

  if (!canRegisterForTournament(tournament) && !hasRegistrationAction) {
    if (closedAsButton) {
      return (
        <Button type="button" variant="secondary" disabled className={className}>
          {getTournamentRegistrationLabel(tournament)}
        </Button>
      );
    }

    return <Badge className={className}>{getTournamentRegistrationLabel(tournament)}</Badge>;
  }

  if (expiredPayment) {
    return (
      <div className={className}>
        <Link href={tournament.contactLink || "/contact"} className={buttonClassName({ variant: "secondary" })}>
          Contact Admin
        </Link>
        <p className="mt-2 max-w-sm text-xs leading-5 text-rose-200">
          Your payment window expired and the slot was released. An administrator must reopen it if capacity is available.
        </p>
      </div>
    );
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
        variant={isRegistered && !hasRegistrationAction ? "secondary" : "primary"}
        disabled={(isRegistered && !hasRegistrationAction) || isChecking}
        onClick={() => {
          if (awaitingRoster) {
            router.push("/profile?tab=teams");
            return;
          }
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
          : pendingPayHere
            ? "Retry Online Payment"
          : awaitingRoster
            ? `Confirm Roster${registration?.pendingInviteCount ? ` · ${registration.pendingInviteCount} Pending` : ""}`
          : readyForPayment
            ? "Continue to Payment"
          : isRegistered
          ? slotLabel ? `Registered · ${slotLabel}` : "Registered"
          : getRegistrationButtonLabel(tournament, status)}
      </Button>
      {pendingBankTransfer ? (
        <div className="mt-2 max-w-sm">
          <p className="text-xs leading-5 text-amber-100">
            {slotLabel ? `${slotLabel} is reserved. ` : "Your slot is reserved. "}
            Complete the transfer and upload your receipt before time runs out.
          </p>
          <ReservationCountdown expiresAt={registration?.reservedUntil} compact onExpire={() => setDeadlineReached(true)} />
        </div>
      ) : pendingPayHere ? (
        <div className="mt-2 max-w-sm">
          <p className="text-xs leading-5 text-amber-100">Your registration is saved, but payment is not confirmed.</p>
          <ReservationCountdown expiresAt={registration?.reservedUntil} compact onExpire={() => setDeadlineReached(true)} />
        </div>
      ) : awaitingRoster ? (
        <p className="mt-2 max-w-sm text-xs leading-5 text-amber-100">Every invited player must accept before payment and slot reservation are unlocked.</p>
      ) : readyForPayment ? (
        <p className="mt-2 max-w-sm text-xs leading-5 text-emerald-200">Your full roster is confirmed. Continue to reserve the slot and pay.</p>
      ) : isRegistered ? (
        <p className="mt-2 text-xs text-emerald-200">Your registration was received. You can track it from your profile.</p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
