"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import RegistrationRosterSection from "@/components/tournament-registration/RegistrationRosterSection";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ProfileSkeleton } from "@/components/ui/skeleton";
import { Section } from "@/components/ui/section";
import { Select } from "@/components/ui/select";
import { useFormFields } from "@/hooks/useFormFields";
import {
  submitTournamentRegistration,
  useTournamentRegistrationStatus,
} from "@/hooks/useTournamentRegistration";
import { useTeams } from "@/hooks/api/useTeams";
import { useToastStore } from "@/hooks/useToastStore";
import {
  initialTournamentRegistrationFormData,
  requiredPlayerGroups,
  substitutePlayerGroups,
  type TournamentRegistrationFormData,
} from "@/lib/tournament-registration";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import { applySavedTeamToRegistrationForm } from "@/lib/teams";
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
  const [selectedSavedTeamId, setSelectedSavedTeamId] = useState("");
  const showToast = useToastStore((state) => state.showToast);
  const { data: savedTeamsData, loading: savedTeamsLoading, refetch: refetchTeams } = useTeams(Boolean(user));
  const savedTeams = useMemo(() => savedTeamsData ?? [], [savedTeamsData]);
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
  const loginRedirectPath = formData.tournament
    ? `/tournament-registration?tournament=${encodeURIComponent(formData.tournament)}`
    : "/tournament-registration";

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

  useEffect(() => {
    const savedTeamId = searchParams.get("savedTeam");

    if (!savedTeamId || savedTeams.length === 0) {
      return;
    }

    const selectedTeam = savedTeams.find((team) => team.id === savedTeamId);
    if (!selectedTeam) {
      return;
    }

    setSelectedSavedTeamId(selectedTeam.id);
    setFields((current) => applySavedTeamToRegistrationForm(selectedTeam, current));
  }, [savedTeams, searchParams, setFields]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(false);
    setError("");
    setStatusMessage("");

    if (authLoading) {
      return;
    }

    if (!user) {
      router.push(`/login?redirect=${encodeURIComponent(loginRedirectPath)}`);
      return;
    }

    if (!user.emailVerified) {
      setError("Please verify your email before registering for a tournament.");
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
      try {
        const nextSavedTeams = (await refetchTeams()) ?? [];
        const matchingTeam = nextSavedTeams.find(
          (team) => team.name.toLowerCase() === formData.teamName.trim().toLowerCase()
        );
        setSelectedSavedTeamId(matchingTeam?.id || "");
      } catch (teamReloadError) {
        console.error("Failed to refresh saved teams:", teamReloadError);
      }
      showToast({ tone: "success", title: "Registration submitted", description: "Your team is now marked as registered." });
      resetFields({
        ...initialTournamentRegistrationFormData,
        tournament: formData.tournament,
      });
      router.replace(`/tournament-registration?tournament=${formData.tournament}`);
    } catch (requestError) {
      console.error("Tournament registration error:", requestError);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Something went wrong. Please try again."
      );
      showToast({
        tone: "error",
        title: "Registration failed",
        description: requestError instanceof Error ? requestError.message : "Something went wrong. Please try again.",
      });
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
      <Section className="pt-6">
        <ProfileSkeleton />
      </Section>
    );
  }

  if (!user) {
    return (
      <Section className="pt-6">
        <Card className="p-6 sm:p-8">
          <h2 className="text-3xl text-white">Register Your Team</h2>
          <p className="mt-3 text-sm text-slate-400">You need to log in before registering for a tournament.</p>
          <div className="mt-6">
            <Link href={`/login?redirect=${encodeURIComponent(loginRedirectPath)}`} className={buttonClassName({})}>
              Go to Login
            </Link>
          </div>
        </Card>
      </Section>
    );
  }

  if (!user.emailVerified) {
    return (
      <Section className="pt-6">
        <Card className="p-6 sm:p-8">
          <h2 className="text-3xl text-white">Register Your Team</h2>
          <div className="mt-5 rounded-[24px] border border-amber-300/20 bg-amber-400/8 p-5">
            <h3 className="text-xl text-white">Verify your email first</h3>
            <p className="mt-3 text-sm text-slate-300">
              Tournament registration is only available for verified accounts. Check your inbox for the verification email, or send a new one below.
            </p>
            <div className="mt-4">
              <ResendVerificationButton email={user.email} />
            </div>
          </div>
        </Card>
      </Section>
    );
  }

  return (
    <Section className="pt-6">
      <div className="grid gap-6">
        <Card className="p-6 sm:p-8">
          <h2 className="text-3xl text-white">Register Your Team</h2>
          <p className="mt-3 text-sm text-slate-400">Complete the full roster submission for the selected tournament.</p>
          <div className="mt-5 rounded-[24px] border border-white/8 bg-white/5 p-5">
            <h3 className="text-xl text-white">Quest Esports Official VALORANT Rulebook</h3>
            <p className="mt-3 text-sm text-slate-400">
              Please read the official Quest Esports VALORANT Tournament Rulebook before submitting your registration.
            </p>
            <div className="mt-4">
              <Link href="/rulebook" className={buttonClassName({ variant: "secondary" })}>
                Open Rulebook
              </Link>
            </div>
          </div>
        </Card>

        <Card className="p-6 sm:p-8">
        <form id="tournamentRegistrationForm" className="grid gap-6" onSubmit={handleSubmit}>
          <fieldset>
            <legend>Saved Teams</legend>
            <div className="grid gap-5">
              <FormField
                label="Reuse Saved Team"
                htmlFor="savedTeam"
                hint="Every tournament registration saves or updates the team on your profile and sends verification emails to roster members."
              >
                <Select
                  id="savedTeam"
                  name="savedTeam"
                  value={selectedSavedTeamId}
                  disabled={loading || savedTeamsLoading || savedTeams.length === 0}
                  onChange={(event) => {
                    const nextTeamId = event.target.value;
                    setSelectedSavedTeamId(nextTeamId);

                    if (!nextTeamId) {
                      return;
                    }

                    const selectedTeam = savedTeams.find((team) => team.id === nextTeamId);
                    if (!selectedTeam) {
                      return;
                    }

                    setFields((current) =>
                      applySavedTeamToRegistrationForm(selectedTeam, current)
                    );
                  }}
                >
                  <option value="">
                    {savedTeamsLoading
                      ? "Loading saved teams..."
                      : savedTeams.length > 0
                        ? "-- Select a saved team --"
                        : "No saved teams yet"}
                  </option>
                  {savedTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          </fieldset>

          <fieldset>
            <legend>Tournament Selection</legend>
            <FormField label="Select Tournament" htmlFor="tournament" required hint={selectedTournament ? `Status: ${getTournamentRegistrationLabel(selectedTournament)}` : undefined}>
              <Select
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
              </Select>
            </FormField>
          </fieldset>

          <fieldset>
            <legend>Team &amp; Captain Information</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Team Name" htmlFor="teamName" required>
                <Input type="text" id="teamName" name="teamName" required value={formData.teamName} onChange={handleFieldChange} />
              </FormField>
              <FormField label="Team Logo" htmlFor="teamLogo" hint="Upload team logo (PNG, JPG, max 5MB)">
                <Input type="file" id="teamLogo" name="teamLogo" accept="image/*" onChange={handleFieldChange} />
              </FormField>
              <FormField label="Team Captain Full Name" htmlFor="captainName" required>
                <Input type="text" id="captainName" name="captainName" required value={formData.captainName} onChange={handleFieldChange} />
              </FormField>
              <FormField label="Team Captain Email Address" htmlFor="captainEmail" required hint="Captain email is tied to your signed-in account.">
                <Input type="email" id="captainEmail" name="captainEmail" required value={formData.captainEmail} readOnly disabled />
              </FormField>
              <FormField label="WhatsApp Contact Number" htmlFor="captainPhone" required>
                <Input type="tel" id="captainPhone" name="captainPhone" placeholder="076 XXX XXXX" required value={formData.captainPhone} onChange={handleFieldChange} />
              </FormField>
              <FormField label="Discord Tag" htmlFor="captainDiscord" required>
                <Input type="text" id="captainDiscord" name="captainDiscord" placeholder="username#1234" required value={formData.captainDiscord} onChange={handleFieldChange} />
              </FormField>
              <FormField label="Riot ID (Valorant)" htmlFor="captainRiotId" required className="sm:col-span-2">
                <Input type="text" id="captainRiotId" name="captainRiotId" placeholder="Username#Region" required value={formData.captainRiotId} onChange={handleFieldChange} />
              </FormField>
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
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Coach Full Name" htmlFor="coachName">
                <Input type="text" id="coachName" name="coachName" value={formData.coachName} onChange={handleFieldChange} />
              </FormField>
              <FormField label="Coach Email Address" htmlFor="coachEmail">
                <Input type="email" id="coachEmail" name="coachEmail" value={formData.coachEmail} onChange={handleFieldChange} />
              </FormField>
              <FormField label="Discord Username" htmlFor="coachDiscord">
                <Input type="text" id="coachDiscord" name="coachDiscord" value={formData.coachDiscord} onChange={handleFieldChange} />
              </FormField>
              <FormField label="Riot ID" htmlFor="coachRiotId">
                <Input type="text" id="coachRiotId" name="coachRiotId" value={formData.coachRiotId} onChange={handleFieldChange} />
              </FormField>
            </div>
          </fieldset>

          <fieldset>
            <legend>Contact &amp; Agreement</legend>
            <FormField label="Contact Email Address" htmlFor="contactEmail" required hint="This email will be used for tournament notifications">
              <Input type="email" id="contactEmail" name="contactEmail" required value={formData.contactEmail} onChange={handleFieldChange} />
            </FormField>
            <label className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-300">
              <input type="checkbox" name="rulebook" required checked={formData.rulebook} onChange={handleFieldChange} />
              <span>I confirm that I have read and agree to the Quest Esports VALORANT Tournament Rulebook.</span>
            </label>
            <label className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-300">
              <input type="checkbox" name="falsityWarning" required checked={formData.falsityWarning} onChange={handleFieldChange} />
              <span>I acknowledge that providing false information or rule violations may result in disqualification.</span>
            </label>
          </fieldset>

          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          {statusMessage ? <p className="text-sm text-emerald-300">{statusMessage}</p> : null}

          <Button
            type="submit"
            disabled={loading || registrationCheckLoading || isAlreadyRegistered}
          >
            {submitButtonLabel}
          </Button>
        </form>
        </Card>

        {submitted ? (
          <Card id="registrationSuccess" className="p-6 sm:p-8">
            <h3 className="text-2xl text-white">Registration Successful!</h3>
            <p className="mt-3 text-sm text-slate-300">
              Your team has been registered and saved to your profile. Roster members
              will receive email invites to confirm their place on the team.
            </p>
          </Card>
        ) : null}
      </div>
    </Section>
  );
}
