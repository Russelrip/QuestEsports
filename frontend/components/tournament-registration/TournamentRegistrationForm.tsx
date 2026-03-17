"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import RegistrationRosterSection from "@/components/tournament-registration/RegistrationRosterSection";
import { useFormFields } from "@/hooks/useFormFields";
import {
  submitTournamentRegistration,
  useTournamentRegistrationStatus,
} from "@/hooks/useTournamentRegistration";
import {
  initialTournamentRegistrationFormData,
  requiredPlayerGroups,
  substitutePlayerGroups,
  type TournamentRegistrationFormData,
} from "@/lib/tournament-registration";
import {
  Tournament,
  canRegisterForTournament,
  getTournamentRegistrationLabel,
} from "@/lib/tournaments";

const prefillKeys: Array<
  keyof Pick<
    TournamentRegistrationFormData,
    "captainName" | "captainEmail" | "captainPhone" | "captainDiscord" | "contactEmail"
  >
> = [
  "captainName",
  "captainEmail",
  "captainPhone",
  "captainDiscord",
  "contactEmail",
];

function RegistrationStatusNote({
  tournament,
}: {
  tournament?: Tournament;
}) {
  if (!tournament) {
    return null;
  }

  return <small>Status: {getTournamentRegistrationLabel(tournament)}</small>;
}

export default function TournamentRegistrationForm({
  tournaments,
}: {
  tournaments: Tournament[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading } = useAuth();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const {
    fields: formData,
    handleFieldChange,
    updateField,
    setFields,
    resetFields,
  } = useFormFields<TournamentRegistrationFormData>(
    initialTournamentRegistrationFormData
  );
  const lastPrefillRef = useRef<Partial<TournamentRegistrationFormData>>({});

  const tournamentMap = useMemo(
    () =>
      tournaments.reduce<Record<string, Tournament>>((accumulator, tournament) => {
        accumulator[tournament.slug] = tournament;
        return accumulator;
      }, {}),
    [tournaments]
  );

  const selectedTournament = formData.tournament
    ? tournamentMap[formData.tournament]
    : undefined;
  const {
    isAlreadyRegistered,
    registrationCheckLoading,
    setIsAlreadyRegistered,
    setStatusMessage,
    statusMessage,
  } = useTournamentRegistrationStatus({
    authLoading,
    tournamentSlug: formData.tournament,
    user,
  });

  useEffect(() => {
    if (!user) {
      lastPrefillRef.current = {};
      return;
    }

    const nextPrefill: Partial<TournamentRegistrationFormData> = {
      captainName: [user.firstName, user.lastName].filter(Boolean).join(" ").trim(),
      captainEmail: user.email || "",
      captainPhone: user.phone || "",
      captainDiscord: user.discordTag || "",
      contactEmail: user.email || "",
    };

    setFields((current) => {
      const previousPrefill = lastPrefillRef.current;
      let hasChanges = false;
      const nextFields: TournamentRegistrationFormData = { ...current };

      prefillKeys.forEach((key) => {
        const prefilledValue = nextPrefill[key] || "";
        const currentValue = current[key] || "";
        const previousValue = previousPrefill[key] || "";

        if (!currentValue || currentValue === previousValue) {
          if (currentValue !== prefilledValue) {
            nextFields[key] = prefilledValue;
            hasChanges = true;
          }
        }
      });

      lastPrefillRef.current = nextPrefill;
      return hasChanges ? nextFields : current;
    });
  }, [setFields, user]);

  useEffect(() => {
    if (authLoading || user) {
      return;
    }

    const params = new URLSearchParams();
    const selectedSlug = searchParams.get("tournament");

    if (selectedSlug) {
      params.set("tournament", selectedSlug);
    }

    const redirectPath = params.toString()
      ? `/tournament-registration?${params.toString()}`
      : "/tournament-registration";

    router.replace(`/login?redirect=${encodeURIComponent(redirectPath)}`);
  }, [authLoading, router, searchParams, user]);

  useEffect(() => {
    const requestedTournamentSlug = searchParams.get("tournament");
    if (!requestedTournamentSlug) {
      return;
    }

    const requestedTournament = tournamentMap[requestedTournamentSlug];

    if (!requestedTournament || !canRegisterForTournament(requestedTournament)) {
      setError("The selected tournament is not open for registration.");
      updateField("tournament", "");
      return;
    }

    setError("");
    if (formData.tournament !== requestedTournamentSlug) {
      updateField("tournament", requestedTournamentSlug);
    }
  }, [formData.tournament, searchParams, tournamentMap, updateField]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(false);
    setError("");
    setStatusMessage("");

    if (authLoading) {
      return;
    }

    if (!user) {
      const redirectPath = formData.tournament
        ? `/tournament-registration?tournament=${encodeURIComponent(formData.tournament)}`
        : "/tournament-registration";

      router.push(`/login?redirect=${encodeURIComponent(redirectPath)}`);
      return;
    }

    if (!selectedTournament || !canRegisterForTournament(selectedTournament)) {
      setError("Please choose a tournament that is currently open.");
      return;
    }

    if (isAlreadyRegistered) {
      setError("You are already registered for this tournament.");
      return;
    }

    setLoading(true);

    try {
      await submitTournamentRegistration(formData);
      setSubmitted(true);
      setIsAlreadyRegistered(true);
      setStatusMessage("Registration saved. Your team is now marked as registered.");
      resetFields({
        ...initialTournamentRegistrationFormData,
        tournament: formData.tournament,
      });
      router.replace(`/tournament-registration?tournament=${formData.tournament}`);
    } catch (requestError) {
      console.error("Tournament registration error:", requestError);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const submitButtonLabel = isAlreadyRegistered
    ? "Registered"
    : loading
      ? "Submitting..."
      : registrationCheckLoading
        ? "Checking..."
        : "Submit Registration";

  if (authLoading) {
    return (
      <section className="tournament-registration-section">
        <div className="form-container">
          <h2>Register Your Team</h2>
          <p>Checking your login status...</p>
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="tournament-registration-section">
        <div className="form-container">
          <h2>Register Your Team</h2>
          <p>You need to log in before registering for a tournament.</p>
          <Link
            href={`/login?redirect=${encodeURIComponent(
              formData.tournament
                ? `/tournament-registration?tournament=${encodeURIComponent(formData.tournament)}`
                : "/tournament-registration"
            )}`}
            className="btn btn-primary"
          >
            Go to Login
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="tournament-registration-section">
      <div className="form-container">
        <h2>Register Your Team</h2>

        <div className="rulebook-box">
          <h3 className="rulebook-title">Quest Esports Official VALORANT Rulebook</h3>
          <p className="rulebook-text">
            Please read the official Quest Esports VALORANT Tournament Rulebook
            before submitting your registration.
          </p>
          <Link href="/rulebook" className="btn btn-secondary">
            Open Rulebook
          </Link>
        </div>

        <form
          id="tournamentRegistrationForm"
          className="tournament-registration-form"
          onSubmit={handleSubmit}
        >
          <fieldset>
            <legend>Tournament Selection</legend>
            <div className="form-group">
              <label htmlFor="tournament">Select Tournament *</label>
              <select
                id="tournament"
                name="tournament"
                required
                value={formData.tournament}
                onChange={handleFieldChange}
                disabled={loading}
              >
                <option value="">-- Select a Tournament --</option>
                {tournaments.map((tournament) => (
                  <option key={tournament.id} value={tournament.slug}>
                    {tournament.title}
                  </option>
                ))}
              </select>
              <RegistrationStatusNote tournament={selectedTournament} />
            </div>
          </fieldset>

          <fieldset>
            <legend>Team &amp; Captain Information</legend>
            <div className="form-group">
              <label htmlFor="teamName">Team Name *</label>
              <input
                type="text"
                id="teamName"
                name="teamName"
                required
                value={formData.teamName}
                onChange={handleFieldChange}
              />
            </div>

            <div className="form-group">
              <label htmlFor="teamLogo">Team Logo</label>
              <input
                type="file"
                id="teamLogo"
                name="teamLogo"
                accept="image/*"
                onChange={handleFieldChange}
              />
              <small>Upload team logo (PNG, JPG, max 5MB)</small>
            </div>

            <div className="form-group">
              <label htmlFor="captainName">Team Captain Full Name *</label>
              <input
                type="text"
                id="captainName"
                name="captainName"
                required
                value={formData.captainName}
                onChange={handleFieldChange}
              />
            </div>

            <div className="form-group">
              <label htmlFor="captainEmail">Team Captain Email Address *</label>
              <input
                type="email"
                id="captainEmail"
                name="captainEmail"
                required
                value={formData.captainEmail}
                readOnly
                disabled
              />
              <small>Captain email is tied to your signed-in account.</small>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="captainPhone">WhatsApp Contact Number *</label>
                <input
                  type="tel"
                  id="captainPhone"
                  name="captainPhone"
                  placeholder="076 XXX XXXX"
                  required
                  value={formData.captainPhone}
                  onChange={handleFieldChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="captainDiscord">Discord Tag *</label>
                <input
                  type="text"
                  id="captainDiscord"
                  name="captainDiscord"
                  placeholder="username#1234"
                  required
                  value={formData.captainDiscord}
                  onChange={handleFieldChange}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="captainRiotId">Riot ID (Valorant) *</label>
              <input
                type="text"
                id="captainRiotId"
                name="captainRiotId"
                placeholder="Username#Region"
                required
                value={formData.captainRiotId}
                onChange={handleFieldChange}
              />
            </div>
          </fieldset>

          <RegistrationRosterSection
            legend="Player Details"
            groups={requiredPlayerGroups}
            values={formData}
            onChange={handleFieldChange}
          />

          <RegistrationRosterSection
            legend="Substitute Players"
            groups={substitutePlayerGroups}
            values={formData}
            onChange={handleFieldChange}
          />

          <fieldset>
            <legend>Coach Details (Optional)</legend>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="coachName">Coach Full Name</label>
                <input
                  type="text"
                  id="coachName"
                  name="coachName"
                  value={formData.coachName}
                  onChange={handleFieldChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="coachDiscord">Discord Username</label>
                <input
                  type="text"
                  id="coachDiscord"
                  name="coachDiscord"
                  value={formData.coachDiscord}
                  onChange={handleFieldChange}
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="coachRiotId">Riot ID</label>
              <input
                type="text"
                id="coachRiotId"
                name="coachRiotId"
                value={formData.coachRiotId}
                onChange={handleFieldChange}
              />
            </div>
          </fieldset>

          <fieldset>
            <legend>Contact &amp; Agreement</legend>
            <div className="form-group">
              <label htmlFor="contactEmail">Contact Email Address *</label>
              <input
                type="email"
                id="contactEmail"
                name="contactEmail"
                required
                value={formData.contactEmail}
                onChange={handleFieldChange}
              />
              <small>This email will be used for tournament notifications</small>
            </div>

            <div className="form-group checkbox">
              <label>
                <input
                  type="checkbox"
                  name="rulebook"
                  required
                  checked={formData.rulebook}
                  onChange={handleFieldChange}
                />{" "}
                I confirm that I have read and agree to the Quest Esports VALORANT
                Tournament Rulebook *
              </label>
            </div>

            <div className="form-group checkbox">
              <label>
                <input
                  type="checkbox"
                  name="falsityWarning"
                  required
                  checked={formData.falsityWarning}
                  onChange={handleFieldChange}
                />{" "}
                I acknowledge that providing false information or rule violations
                may result in disqualification *
              </label>
            </div>
          </fieldset>

          {error ? <p className="error-message">{error}</p> : null}
          {statusMessage ? <p className="success-inline">{statusMessage}</p> : null}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || registrationCheckLoading || isAlreadyRegistered}
          >
            {submitButtonLabel}
          </button>
        </form>

        {submitted ? (
          <div id="registrationSuccess" className="success-message">
            <h3>Registration Successful!</h3>
            <p>
              Your team has been registered for the tournament. You will receive
              a confirmation email shortly.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
