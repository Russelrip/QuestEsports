"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/auth";
import {
  appendTournamentRegistrationFormData,
  type TournamentRegistrationFormData,
} from "@/lib/tournament-registration";
import {
  isTournamentRegisteredLocally,
  markTournamentRegistered,
} from "@/lib/registered-tournaments";

const parseApiResponse = async <T>(
  response: Response,
  fallback: string
): Promise<{ data: T | null; message: string }> => {
  try {
    const data = await response.json();
    return {
      data,
      message: data?.message || fallback,
    };
  } catch {
    return {
      data: null,
      message: fallback,
    };
  }
};

export function useTournamentRegistrationStatus({
  authLoading,
  tournamentSlug,
  user,
}: {
  authLoading: boolean;
  tournamentSlug: string;
  user: { email?: string | null } | null;
}) {
  const [isAlreadyRegistered, setIsAlreadyRegistered] = useState(false);
  const [registrationCheckLoading, setRegistrationCheckLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    const checkRegistration = async () => {
      if (!tournamentSlug) {
        setIsAlreadyRegistered(false);
        setRegistrationCheckLoading(false);
        setStatusMessage("");
        return;
      }

      if (isTournamentRegisteredLocally(tournamentSlug)) {
        setIsAlreadyRegistered(true);
        setRegistrationCheckLoading(false);
        setStatusMessage("You are already registered for this tournament.");
        return;
      }

      if (authLoading) {
        setRegistrationCheckLoading(true);
        return;
      }

      if (!user?.email) {
        setIsAlreadyRegistered(false);
        setRegistrationCheckLoading(false);
        setStatusMessage("");
        return;
      }

      try {
        setRegistrationCheckLoading(true);
        setStatusMessage("");

        const response = await apiFetch(`/api/tournament-registration/status/${tournamentSlug}`);
        const { data, message } = await parseApiResponse<{ isRegistered?: boolean }>(
          response,
          "Could not verify your registration."
        );

        if (!response.ok) {
          throw new Error(message);
        }

        const registered = Boolean(data?.isRegistered);

        if (cancelled) {
          return;
        }

        setIsAlreadyRegistered(registered);
        setStatusMessage(
          registered ? "You are already registered for this tournament." : ""
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setIsAlreadyRegistered(false);
        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Could not verify your registration."
        );
      } finally {
        if (!cancelled) {
          setRegistrationCheckLoading(false);
        }
      }
    };

    void checkRegistration();

    return () => {
      cancelled = true;
    };
  }, [authLoading, tournamentSlug, user]);

  return {
    isAlreadyRegistered,
    registrationCheckLoading,
    setIsAlreadyRegistered,
    setStatusMessage,
    statusMessage,
  };
}

export async function submitTournamentRegistration(
  formData: TournamentRegistrationFormData
) {
  const response = await apiFetch("/api/tournament-registration", {
    method: "POST",
    body: appendTournamentRegistrationFormData(formData),
  });
  const { message } = await parseApiResponse(response, "Registration failed.");

  if (!response.ok) {
    throw new Error(message);
  }

  markTournamentRegistered(formData.tournament);
  return message;
}
