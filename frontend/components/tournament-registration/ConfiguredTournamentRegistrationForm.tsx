"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import { Button, buttonClassName } from "@/components/ui/button";
import ReservationCountdown from "@/components/payments/ReservationCountdown";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useTeams } from "@/hooks/api/useTeams";
import { apiFetch } from "@/lib/auth";
import { ApiRequestError, readApiResponse } from "@/lib/api";
import { PayHereCheckout, submitPayHereCheckout } from "@/lib/payments";
import { markTournamentRegistered } from "@/lib/registered-tournaments";
import type { SavedTeam } from "@/lib/teams";
import {
  emptyCoachDraft,
  getCoachPayload,
  getCoachValidationMessage,
  type CoachDraft,
} from "@/lib/tournament-coach";
import type { Tournament, TournamentRegistrationField } from "@/lib/tournaments";

type MemberDraft = {
  name: string;
  email: string;
  discord: string;
  gameId: string;
  role: "PLAYER" | "SUBSTITUTE";
  additionalData: Record<string, string | boolean>;
};

type BankTransferReservation = {
  orderId: string;
  assignedSlotNumber: number;
  amount: number;
  currency: string;
  expiresAt: string;
};

type GameIdentityConfig = {
  label: string;
  placeholder: string;
  hint: string;
  pattern?: string;
  title?: string;
};

type ExistingRegistrationState = {
  paymentStatus: "unpaid" | "pending" | "paid";
  verificationStatus: "pending" | "verified" | "flagged";
  pendingInviteCount: number;
  reservedUntil?: string | null;
  contactLink?: string | null;
  payment?: {
    orderId: string;
    provider: string;
    status: string;
  } | null;
};

type RegistrationSubmissionResponse = {
  success?: boolean;
  message?: string;
  checkout?: PayHereCheckout | null;
  bankTransfer?: BankTransferReservation | null;
  awaitingTeamVerification?: boolean;
  readyForPayment?: boolean;
  pendingInviteCount?: number;
  registration?: ExistingRegistrationState | null;
};

const emptyMember = (): MemberDraft => ({ name: "", email: "", discord: "", gameId: "", role: "PLAYER", additionalData: {} });

export default function ConfiguredTournamentRegistrationForm({ tournament }: { tournament: Tournament }) {
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { data: savedTeams } = useTeams(Boolean(user) && tournament.entryType === "team");
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    discord: "",
    gameId: "",
    teamName: "",
    teamTag: "",
    country: "Sri Lanka",
    contactEmail: "",
    organizationRequested: false,
    rulebookAccepted: false,
    falsityWarningAccepted: false,
  });
  const minimumAdditionalPlayers = Math.max(0, (tournament.minRosterSize || tournament.teamSize || 1) - 1);
  const [members, setMembers] = useState<MemberDraft[]>(() => Array.from({ length: minimumAdditionalPlayers }, emptyMember));
  const [entryData, setEntryData] = useState<Record<string, string | boolean>>({});
  const [captainAdditionalData, setCaptainAdditionalData] = useState<Record<string, string | boolean>>({});
  const [coach, setCoach] = useState<CoachDraft>(() => ({ ...emptyCoachDraft }));
  const [coachSelected, setCoachSelected] = useState(false);
  const [teamLogo, setTeamLogo] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [existingRegistration, setExistingRegistration] = useState<ExistingRegistrationState | null>(null);
  const [checkingRegistration, setCheckingRegistration] = useState(true);
  const [selectedSavedTeamId, setSelectedSavedTeamId] = useState("");
  const [pendingSavedTeam, setPendingSavedTeam] = useState<SavedTeam | null>(null);

  const entryFields = useMemo(() => (tournament.registrationFields || []).filter((field) => field.scope === "entry"), [tournament.registrationFields]);
  const memberFields = useMemo(() => (tournament.registrationFields || []).filter((field) => field.scope === "member"), [tournament.registrationFields]);
  const visibleEntryFields = useMemo(() => entryFields.filter((field) => !isGameIdentityField(field, tournament.game)), [entryFields, tournament.game]);
  const visibleMemberFields = useMemo(() => memberFields.filter((field) => !isGameIdentityField(field, tournament.game)), [memberFields, tournament.game]);
  const identityEntryFields = useMemo(() => entryFields.filter((field) => isGameIdentityField(field, tournament.game)), [entryFields, tournament.game]);
  const identityMemberFields = useMemo(() => memberFields.filter((field) => isGameIdentityField(field, tournament.game)), [memberFields, tournament.game]);
  const gameIdentity = useMemo(() => getGameIdentityConfig(tournament.game), [tournament.game]);
  const maximumAdditionalPlayers = Math.max(0, (tournament.maxRosterSize || tournament.teamSize || 1) + (tournament.maxSubstitutes || 0) - 1);
  const activePlayerCount = 1 + members.filter((member) => member.role === "PLAYER").length;
  const substituteCount = members.filter((member) => member.role === "SUBSTITUTE").length;
  const coachEnabled = Boolean(tournament.allowCoach);
  const coachIsRequired = Boolean(tournament.coachRequired);
  const coachIsSelected = coachEnabled && (coachIsRequired || coachSelected);
  const coachIssue = coachIsSelected ? getCoachValidationMessage(coach, coachIsRequired, true) : "";
  const rosterIssue = getRosterValidationMessage({
    activePlayerCount,
    substituteCount,
    minRosterSize: tournament.minRosterSize || tournament.teamSize || 1,
    maxRosterSize: tournament.maxRosterSize || tournament.teamSize || 1,
    maxSubstitutes: tournament.maxSubstitutes || 0,
  });

  useEffect(() => {
    if (!rosterIssue) {
      setError((current) => current.startsWith("This event requires") ? "" : current);
    }
  }, [rosterIssue]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace(`/login?redirect=${encodeURIComponent(`/tournaments/${tournament.slug}/register`)}`);
      return;
    }
    if (user) {
      setForm((current) => ({
        ...current,
        fullName: current.fullName || `${user.firstName} ${user.lastName}`.trim(),
        phone: current.phone || user.phone || "",
        discord: current.discord || user.discordTag || "",
        contactEmail: user.email,
      }));
    }
  }, [isLoading, router, tournament.slug, user]);

  const loadRegistrationStatus = useCallback(async () => {
    if (!user) return;
    setCheckingRegistration(true);
    try {
      const response = await apiFetch(`/api/tournaments/${tournament.slug}/registration-status`);
      const data = await readApiResponse<{
        success?: boolean;
        isRegistered?: boolean;
        registration?: ExistingRegistrationState | null;
      }>(response, "Could not check your registration status.");
      if (response.ok && data.isRegistered && data.registration) {
        setExistingRegistration(data.registration);
      } else if (response.ok) {
        setExistingRegistration(null);
      }
    } catch {
      // The form remains usable when the optional status check is unavailable.
    } finally {
      setCheckingRegistration(false);
    }
  }, [tournament.slug, user]);

  useEffect(() => {
    if (user?.emailVerified) void loadRegistrationStatus();
    else setCheckingRegistration(false);
  }, [loadRegistrationStatus, user?.emailVerified]);

  const updateMember = (index: number, updates: Partial<MemberDraft>) => {
    setMembers((current) => current.map((member, memberIndex) => memberIndex === index ? { ...member, ...updates } : member));
  };

  const populateSavedTeam = (team: SavedTeam, omittedMemberId?: string) => {
    setForm((current) => ({
      ...current,
      teamName: team.name,
      teamTag: team.teamTag || "",
      country: team.country || "Sri Lanka",
      organizationRequested: false,
    }));
    setMembers(team.members
      .filter((member) => member.id !== omittedMemberId && member.role !== "CAPTAIN" && member.role !== "COACH")
      .map((member) => ({
        name: member.name,
        email: member.email,
        discord: member.discord || "",
        gameId: member.riotId || "",
        role: member.role === "SUBSTITUTE" ? "SUBSTITUTE" : "PLAYER",
        additionalData: {},
      })));
    const savedCoach = team.members.find((member) => member.role === "COACH");
    setCoach(savedCoach ? {
      name: savedCoach.name,
      email: savedCoach.email,
      phone: "",
      discord: savedCoach.discord || "",
      gameId: savedCoach.riotId || "",
    } : { ...emptyCoachDraft });
    setCoachSelected(Boolean(savedCoach));
    setPendingSavedTeam(null);
    setError("");
  };

  const selectSavedTeam = (teamId: string) => {
    setSelectedSavedTeamId(teamId);
    setPendingSavedTeam(null);
    const team = savedTeams?.find((candidate) => candidate.id === teamId);
    if (!team) return;

    const activePlayers = team.members.filter((member) => member.role === "PLAYER");
    const substituteTotal = team.members.filter((member) => member.role === "SUBSTITUTE").length;
    const minimumActivePlayers = tournament.minRosterSize || tournament.teamSize || 1;
    const maximumActivePlayers = tournament.maxRosterSize || tournament.teamSize || 1;
    const needsOnePlayerRemoved =
      1 + activePlayers.length === maximumActivePlayers + 1 &&
      maximumActivePlayers >= minimumActivePlayers &&
      substituteTotal <= (tournament.maxSubstitutes || 0);

    if (needsOnePlayerRemoved) {
      setPendingSavedTeam(team);
      return;
    }

    populateSavedTeam(team);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    if (pendingSavedTeam) {
      setError("Choose the active player to leave out before submitting this registration.");
      return;
    }
    if (tournament.entryType === "team" && rosterIssue) {
      setError(rosterIssue);
      return;
    }
    if (coachIssue) {
      setError(coachIssue);
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");

    const body = new FormData();
    Object.entries(form).forEach(([key, value]) => body.append(key, String(value)));
    const submittedEntryData = { ...entryData };
    const submittedCaptainData = { ...captainAdditionalData };
    identityEntryFields.forEach((field) => { submittedEntryData[field.key] = form.gameId; });
    identityMemberFields.forEach((field) => { submittedCaptainData[field.key] = form.gameId; });
    const submittedMembers = members.map((member) => ({
      ...member,
      additionalData: {
        ...member.additionalData,
        ...Object.fromEntries(identityMemberFields.map((field) => [field.key, member.gameId])),
      },
    }));
    body.append("additionalData", JSON.stringify(submittedEntryData));
    body.append("captainAdditionalData", JSON.stringify(submittedCaptainData));
    body.append("members", JSON.stringify(submittedMembers));
    const coachPayload = getCoachPayload(coach, coachEnabled, coachIsSelected);
    if (coachPayload) body.append("coach", JSON.stringify(coachPayload));
    if (teamLogo) body.append("teamLogo", teamLogo);

    try {
      const response = await apiFetch(`/api/tournaments/${tournament.slug}/registrations`, {
        method: "POST",
        body,
        timeoutMs: 60_000,
      });
      const data = await readApiResponse<RegistrationSubmissionResponse>(response, "Registration could not be submitted.");
      if (!response.ok || !data.success) throw new Error(data.message || "Registration could not be submitted.");
      markTournamentRegistered(tournament.slug);
      if (data.awaitingTeamVerification || data.readyForPayment) {
        setExistingRegistration({
          paymentStatus: "unpaid",
          verificationStatus: data.readyForPayment ? "verified" : "pending",
          pendingInviteCount: data.pendingInviteCount || 0,
          payment: null,
        });
        return;
      }
      if (data.checkout) {
        submitPayHereCheckout(data.checkout);
        return;
      }
      if (data.bankTransfer) {
        router.push(
          `/tournaments/${tournament.slug}/payment?order=${encodeURIComponent(data.bankTransfer.orderId)}`
        );
        return;
      }
      setSuccess(data.message || "Registration submitted successfully.");
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Registration could not be submitted.";
      const submissionMayHaveCompleted = nextError instanceof ApiRequestError && (nextError.status === 0 || nextError.status === 408);
      setError(submissionMayHaveCompleted
        ? `${message} Check My registrations in your profile before submitting again.`
        : message);
    } finally {
      setLoading(false);
    }
  };

  const continueToPayment = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/tournaments/${tournament.slug}/registrations`, {
        method: "POST",
        json: { resumePayment: true },
        timeoutMs: 60_000,
      });
      const data = await readApiResponse<RegistrationSubmissionResponse>(response, "Payment could not be started.");
      if (!response.ok || !data.success) throw new Error(data.message || "Payment could not be started.");
      if (data.checkout) {
        submitPayHereCheckout(data.checkout);
        return;
      }
      if (data.bankTransfer) {
        router.push(`/tournaments/${tournament.slug}/payment?order=${encodeURIComponent(data.bankTransfer.orderId)}`);
        return;
      }
      await loadRegistrationStatus();
      setError(data.message || "Payment is not available yet.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Payment could not be started.");
    } finally {
      setLoading(false);
    }
  };

  const cancelRegistration = async () => {
    if (!window.confirm("Cancel this unpaid registration? Your saved team will remain available so you can correct it and register again.")) return;
    setCancelling(true);
    setError("");
    try {
      const response = await apiFetch(`/api/tournaments/${tournament.slug}/registrations`, {
        method: "DELETE",
      });
      const data = await readApiResponse<{ success?: boolean; message?: string }>(response, "Registration could not be cancelled.");
      if (!response.ok || !data.success) throw new Error(data.message || "Registration could not be cancelled.");
      setExistingRegistration(null);
      setSuccess("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Registration could not be cancelled.");
    } finally {
      setCancelling(false);
    }
  };

  if (isLoading || !user) return <Card className="p-8"><p className="text-slate-300">Loading your account…</p></Card>;
  if (!user.emailVerified) {
    return <Card className="p-8"><h2 className="text-3xl text-white">Verify your email first</h2><p className="mt-3 text-sm text-slate-300">A verified account is required before registering.</p><div className="mt-5"><ResendVerificationButton email={user.email} /></div></Card>;
  }
  if (!tournament.registrationPaymentAvailable) {
    return <Card className="p-8"><h2 className="text-3xl text-white">Paid registration is not available yet</h2><p className="mt-3 text-sm leading-7 text-slate-300">Quest has not connected an online payment provider. No payment or registration draft has been created.</p><Link href={`/tournaments/${tournament.slug}`} className={buttonClassName({ variant: "secondary", className: "mt-5" })}>Return to tournament</Link></Card>;
  }
  if (checkingRegistration) {
    return <Card className="p-8"><p className="text-slate-300">Checking your registration status…</p></Card>;
  }
  if (existingRegistration?.payment?.status === "expired") {
    return (
      <Card className="mx-auto max-w-2xl border-rose-300/25 p-8 text-center sm:p-10">
        <p className="text-xs uppercase tracking-[0.25em] text-rose-200">Payment window expired</p>
        <h2 className="mt-4 text-3xl text-white">Your tournament slot was released</h2>
        <p className="mt-4 text-sm leading-7 text-slate-300">Please contact an administrator for assistance. Payment cannot be restarted until an administrator assigns another available slot.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href={existingRegistration.contactLink || tournament.contactLink || "/contact"} className={buttonClassName({})}>Contact Admin</Link>
          <Link href="/profile" className={buttonClassName({ variant: "secondary" })}>Open profile</Link>
        </div>
      </Card>
    );
  }
  if (existingRegistration && tournament.entryType === "team" && (tournament.registrationFee?.amount || 0) > 0) {
    const rosterPending = existingRegistration.verificationStatus !== "verified";
    const bankPayment = existingRegistration.payment?.provider === "bank_transfer"
      ? existingRegistration.payment
      : null;
    return (
      <Card className="mx-auto max-w-2xl p-8 text-center sm:p-10">
        <p className={`text-xs uppercase tracking-[0.25em] ${rosterPending ? "text-amber-200" : "text-emerald-200"}`}>
          {rosterPending ? "Roster confirmation required" : "Roster confirmed"}
        </p>
        <h2 className="mt-4 text-3xl text-white">
          {rosterPending ? "Payment is locked until every roster member accepts" : `Your team is ready for ${tournament.title}`}
        </h2>
        <p className="mt-4 text-sm leading-7 text-slate-300">
          {existingRegistration.verificationStatus === "flagged"
            ? "A roster member declined the invitation. Open the saved team and send that roster member’s invitation again before continuing."
            : rosterPending
              ? `${existingRegistration.pendingInviteCount} roster invitation${existingRegistration.pendingInviteCount === 1 ? " is" : "s are"} still pending. No payment or slot reservation will be created until the full roster is confirmed.`
              : "Every roster member has accepted. You can now reserve the slot and continue to payment."}
        </p>
        {existingRegistration.reservedUntil && existingRegistration.paymentStatus === "pending" ? (
          <div className="mt-6 text-left">
            <ReservationCountdown expiresAt={existingRegistration.reservedUntil} />
          </div>
        ) : null}
        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {rosterPending ? (
            <>
              <Link href="/profile?tab=teams" className={buttonClassName({})}>Manage invitations</Link>
              <Button type="button" variant="secondary" disabled={loading} onClick={() => void loadRegistrationStatus()}>{loading ? "Checking…" : "Check again"}</Button>
            </>
          ) : bankPayment?.orderId ? (
            <Link href={`/tournaments/${tournament.slug}/payment?order=${encodeURIComponent(bankPayment.orderId)}`} className={buttonClassName({})}>Open bank transfer details</Link>
          ) : existingRegistration.paymentStatus === "paid" ? (
            <Link href={`/tournaments/${tournament.slug}`} className={buttonClassName({})}>View tournament</Link>
          ) : (
            <Button type="button" disabled={loading} onClick={() => void continueToPayment()}>{loading ? "Starting payment…" : "Reserve slot and continue to payment"}</Button>
          )}
          <Link href="/profile" className={buttonClassName({ variant: "secondary" })}>Open profile</Link>
          {existingRegistration.paymentStatus === "unpaid" ? (
            <Button type="button" variant="danger" disabled={loading || cancelling} onClick={() => void cancelRegistration()}>
              {cancelling ? "Cancelling…" : "Cancel registration"}
            </Button>
          ) : null}
        </div>
      </Card>
    );
  }
  if (success) {
    return (
      <Card className="mx-auto max-w-2xl p-8 text-center sm:p-10">
        <p className="text-xs uppercase tracking-[0.25em] text-emerald-200">Registration received</p>
        <h2 className="mt-4 text-3xl text-white">You are registered for {tournament.title}</h2>
        <p className="mt-4 text-sm leading-7 text-slate-300">{success} Your registration and review status are available in your profile.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link href="/profile" className={buttonClassName({})}>View my registrations</Link>
          <Link href={`/tournaments/${tournament.slug}`} className={buttonClassName({ variant: "secondary" })}>Return to tournament</Link>
        </div>
      </Card>
    );
  }

  return (
    <form className="grid gap-6" onSubmit={submit}>
      <Card className="p-6 sm:p-8">
        <p className="text-xs uppercase tracking-[0.25em] text-purple-200/80">{tournament.entryType === "solo" ? "Solo Entry" : "Team Entry"}</p>
        <h2 className="mt-3 text-3xl text-white">Register for {tournament.title}</h2>
        <p className="mt-3 text-sm text-slate-400">Your entry will be submitted directly to this tournament.</p>
        <div className="mt-5 flex flex-wrap gap-3 text-sm">
          <span className="rounded-full border border-white/10 px-3 py-2 text-slate-300">{tournament.registrationMode === "slot_based" ? "Slot based" : "Open entry"}</span>
          <span className="rounded-full border border-white/10 px-3 py-2 text-slate-300">{getRegistrationFeeLabel(tournament)}</span>
        </div>
        {tournament.rulebook ? <Link href={`/rulebooks/${tournament.rulebook.slug}`} className={buttonClassName({ variant: "secondary", className: "mt-5" })}>Read {tournament.rulebook.title}</Link> : null}
      </Card>

      <Card className="grid gap-6 p-6 sm:p-8">
        {tournament.entryType === "team" && savedTeams && savedTeams.length > 0 ? (
          <div className="grid gap-4">
            <FormField label="Reuse a saved team" htmlFor="savedTeam">
              <Select id="savedTeam" value={selectedSavedTeamId} onChange={(event) => selectSavedTeam(event.target.value)}>
                <option value="">Start with a new entry</option>
                {savedTeams.filter((team) => team.isCaptain).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </Select>
            </FormField>
            {pendingSavedTeam ? (
              <div className="grid gap-4 rounded-[22px] border border-amber-300/25 bg-amber-300/[0.06] p-5">
                <div>
                  <p className="font-semibold text-amber-100">Choose one active player to leave out</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {pendingSavedTeam.name} has one more active player than this event permits because the captain counts as a player. Your saved team will not be changed.
                  </p>
                </div>
                <FormField label="Player to leave out" htmlFor="omittedSavedTeamMember">
                  <Select id="omittedSavedTeamMember" defaultValue="" onChange={(event) => {
                    if (event.target.value) populateSavedTeam(pendingSavedTeam, event.target.value);
                  }}>
                    <option value="">Select a player</option>
                    {pendingSavedTeam.members
                      .filter((member) => member.role === "PLAYER")
                      .map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </Select>
                </FormField>
              </div>
            ) : null}
          </div>
        ) : null}

        {tournament.entryType === "team" ? (
          <fieldset className="grid gap-5 sm:grid-cols-2">
            <legend className="mb-4 text-xl text-white sm:col-span-2">Team details</legend>
            <FormField label="Team name" required><Input required value={form.teamName} onChange={(event) => setForm((current) => ({ ...current, teamName: event.target.value }))} /></FormField>
            <FormField label="Team tag" required><Input required maxLength={12} value={form.teamTag} onChange={(event) => setForm((current) => ({ ...current, teamTag: event.target.value }))} /></FormField>
            <FormField label="Country" required><Input required value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))} /></FormField>
            <FormField label="Team logo"><Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setTeamLogo(event.target.files?.[0] || null)} /></FormField>
          </fieldset>
        ) : null}

        <fieldset className="grid gap-5 sm:grid-cols-2">
          <legend className="mb-4 text-xl text-white sm:col-span-2">Contact details</legend>
          <FormField label="Full name" required><Input required value={form.fullName} onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))} /></FormField>
          <FormField label="Email"><Input disabled value={form.contactEmail} /></FormField>
          <FormField label="WhatsApp number" required><Input required value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></FormField>
          <FormField label="Discord"><Input value={form.discord} onChange={(event) => setForm((current) => ({ ...current, discord: event.target.value }))} /></FormField>
          <FormField label={gameIdentity.label} required hint={gameIdentity.hint}><Input required value={form.gameId} placeholder={gameIdentity.placeholder} pattern={gameIdentity.pattern} title={gameIdentity.title} autoCapitalize="none" spellCheck={false} onChange={(event) => setForm((current) => ({ ...current, gameId: event.target.value }))} /></FormField>
          {visibleMemberFields.map((field) => <ConfiguredField key={field.key} field={field} value={captainAdditionalData[field.key] || ""} onChange={(value) => setCaptainAdditionalData((current) => ({ ...current, [field.key]: value }))} />)}
        </fieldset>

        {visibleEntryFields.length > 0 ? <fieldset className="grid gap-5 sm:grid-cols-2"><legend className="mb-4 text-xl text-white sm:col-span-2">Game details</legend>{visibleEntryFields.map((field) => <ConfiguredField key={field.key} field={field} value={entryData[field.key] || ""} onChange={(value) => setEntryData((current) => ({ ...current, [field.key]: value }))} />)}</fieldset> : null}
      </Card>

      {tournament.entryType === "team" ? (
        <Card className="p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4"><div><h3 className="text-2xl text-white">Roster</h3><p className="mt-2 text-sm text-slate-400">The captain counts as active player #1. Add {formatAdditionalPlayerRequirement(tournament.minRosterSize || tournament.teamSize || 1, tournament.maxRosterSize || tournament.teamSize || 1)} and up to {tournament.maxSubstitutes || 0} substitutes.</p></div>{members.length < maximumAdditionalPlayers ? <Button type="button" variant="secondary" onClick={() => setMembers((current) => [...current, emptyMember()])}>Add roster member</Button> : null}</div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-white/10 px-3 py-2 text-slate-300">{activePlayerCount} active players (captain included)</span>
            <span className="rounded-full border border-white/10 px-3 py-2 text-slate-300">{substituteCount} substitutes</span>
          </div>
          {rosterIssue ? <p className="mt-4 text-sm text-amber-200">{rosterIssue}</p> : null}
          <div className="mt-6 grid gap-5">
            {members.map((member, index) => (
              <div key={index} className="rounded-[22px] border border-white/10 bg-black/20 p-5">
                <div className="mb-4 flex items-center justify-between"><h4 className="text-lg text-white">Roster member {index + 2}</h4>{members.length > minimumAdditionalPlayers ? <button type="button" className="text-sm text-rose-300" onClick={() => setMembers((current) => current.filter((_, memberIndex) => memberIndex !== index))}>Remove</button> : null}</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Name" required><Input required value={member.name} onChange={(event) => updateMember(index, { name: event.target.value })} /></FormField>
                  <FormField label="Email" required><Input type="email" required value={member.email} onChange={(event) => updateMember(index, { email: event.target.value })} /></FormField>
                  <FormField label="Discord"><Input value={member.discord} onChange={(event) => updateMember(index, { discord: event.target.value })} /></FormField>
                  <FormField label={gameIdentity.label} required hint={gameIdentity.hint}><Input required value={member.gameId} placeholder={gameIdentity.placeholder} pattern={gameIdentity.pattern} title={gameIdentity.title} autoCapitalize="none" spellCheck={false} onChange={(event) => updateMember(index, { gameId: event.target.value })} /></FormField>
                  <FormField label="Role"><Select value={member.role} onChange={(event) => updateMember(index, { role: event.target.value as MemberDraft["role"] })}><option value="PLAYER">Player</option><option value="SUBSTITUTE">Substitute</option></Select></FormField>
                  {visibleMemberFields.map((field) => <ConfiguredField key={field.key} field={field} value={member.additionalData[field.key] || ""} onChange={(value) => updateMember(index, { additionalData: { ...member.additionalData, [field.key]: value } })} />)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {coachEnabled ? <Card className="p-6 sm:p-8">
        {!coachIsRequired ? <label className="mb-5 flex items-start gap-3 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={coachSelected}
            onChange={(event) => {
              const selected = event.target.checked;
              setCoachSelected(selected);
              if (!selected) setCoach({ ...emptyCoachDraft });
            }}
          />
          <span><span className="block text-base text-white">Add a coach</span><span className="mt-1 block text-slate-400">Include a coach’s contact details with this registration.</span></span>
        </label> : null}
        {coachIsSelected ? <fieldset className="grid gap-5 sm:grid-cols-2">
          <legend className="mb-4 text-xl text-white sm:col-span-2">TEAM COACH{coachIsRequired ? " — REQUIRED" : ""}</legend>
          <FormField label="Full Name" required><Input required value={coach.name} onChange={(event) => setCoach((current) => ({ ...current, name: event.target.value }))} /></FormField>
          <FormField label="Email" required><Input type="email" required value={coach.email} onChange={(event) => setCoach((current) => ({ ...current, email: event.target.value }))} /></FormField>
          <FormField label="Contact Number" required><Input required value={coach.phone} onChange={(event) => setCoach((current) => ({ ...current, phone: event.target.value }))} /></FormField>
          <FormField label="Discord Username" required><Input required value={coach.discord} onChange={(event) => setCoach((current) => ({ ...current, discord: event.target.value }))} /></FormField>
          <FormField label="Riot ID/IGN" required><Input required value={coach.gameId} onChange={(event) => setCoach((current) => ({ ...current, gameId: event.target.value }))} /></FormField>
        </fieldset> : null}
      </Card> : null}

      <Card className="grid gap-4 p-6 sm:p-8">
        <label className="flex gap-3 text-sm text-slate-300"><input type="checkbox" required checked={form.rulebookAccepted} onChange={(event) => setForm((current) => ({ ...current, rulebookAccepted: event.target.checked }))} /><span>I have read and accept the tournament rulebook and competition rules.</span></label>
        <label className="flex gap-3 text-sm text-slate-300"><input type="checkbox" required checked={form.falsityWarningAccepted} onChange={(event) => setForm((current) => ({ ...current, falsityWarningAccepted: event.target.checked }))} /><span>I confirm that the registration information is accurate.</span></label>
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-300">{success} <Link className="underline" href="/profile">Open dashboard</Link></p> : null}
        <Button type="submit" disabled={loading || Boolean(pendingSavedTeam)}>
          {loading
            ? "Submitting…"
            : tournament.paymentMethod === "bank_transfer"
              ? "Reserve slot and get bank details"
              : tournament.registrationFee?.amount > 0
                ? `Pay ${tournament.registrationFee.currency} ${tournament.registrationFee.amount.toFixed(2)}`
                : "Submit registration"}
        </Button>
      </Card>
    </form>
  );
}

function formatAdditionalPlayerRequirement(minRosterSize: number, maxRosterSize: number) {
  const minimum = Math.max(0, minRosterSize - 1);
  const maximum = Math.max(0, maxRosterSize - 1);
  return minimum === maximum ? `exactly ${minimum} more active players` : `${minimum}-${maximum} more active players`;
}

function getRosterValidationMessage({
  activePlayerCount,
  substituteCount,
  minRosterSize,
  maxRosterSize,
  maxSubstitutes,
}: {
  activePlayerCount: number;
  substituteCount: number;
  minRosterSize: number;
  maxRosterSize: number;
  maxSubstitutes: number;
}) {
  if (
    activePlayerCount >= minRosterSize &&
    activePlayerCount <= maxRosterSize &&
    substituteCount <= maxSubstitutes
  ) return "";

  const requiredPlayers = minRosterSize === maxRosterSize
    ? `exactly ${minRosterSize}`
    : `${minRosterSize}-${maxRosterSize}`;
  return `This event requires ${requiredPlayers} active players, including the captain, and allows up to ${maxSubstitutes} substitutes. This roster currently has ${activePlayerCount} active players and ${substituteCount} substitutes.`;
}

function getRegistrationFeeLabel(tournament: Tournament) {
  if (!tournament.registrationFee?.amount) return "Free registration";
  const amounts = (tournament.registrationFeeTiers || []).map((tier) => tier.amount);
  if (amounts.length > 0) {
    return `${tournament.registrationFee.currency} ${Math.min(...amounts).toFixed(2)}–${Math.max(...amounts).toFixed(2)} by slot`;
  }
  return `${tournament.registrationFee.currency} ${tournament.registrationFee.amount.toFixed(2)}`;
}

function isGameIdentityField(field: TournamentRegistrationField, game: string) {
  const fieldText = `${field.key} ${field.label}`.toLowerCase();
  const gameWords = game.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
  return /(?:riot|ign|in[ -]?game|player[ -]?id|game[ -]?id|uid)/i.test(fieldText) ||
    (/\bid\b/i.test(fieldText.replace(/[_-]/g, " ")) && gameWords.some((word) => fieldText.includes(word)));
}

function getGameIdentityConfig(game: string): GameIdentityConfig {
  const normalizedGame = game.trim().toLowerCase();
  if (normalizedGame.includes("valorant")) {
    return {
      label: "Valorant Riot ID",
      placeholder: "PlayerName#123",
      hint: "Enter the full Riot ID, including the # tagline.",
      pattern: "[^#\\r\\n]{3,16}#[A-Za-z0-9]{3,5}",
      title: "Use the format PlayerName#123, including the # tagline.",
    };
  }
  if (/(?:call of duty|codm)/i.test(normalizedGame)) {
    return { label: "CODM UID / IGN", placeholder: "Player UID or exact IGN", hint: "Use the identifier shown in your CODM profile." };
  }
  if (normalizedGame.includes("pubg")) {
    return { label: "PUBG Player ID / IGN", placeholder: "Player ID or exact IGN", hint: "Use the identifier shown in your PUBG profile." };
  }
  if (normalizedGame.includes("mobile legends")) {
    return { label: "MLBB Game ID / Server ID", placeholder: "123456789 (1234)", hint: "Enter the game ID and server ID shown in your profile." };
  }
  if (normalizedGame.includes("free fire")) {
    return { label: "Free Fire UID / IGN", placeholder: "Player UID or exact IGN", hint: "Use the identifier shown in your Free Fire profile." };
  }
  return {
    label: `${game || "Game"} IGN / Player ID`,
    placeholder: "Exact in-game name or player ID",
    hint: "Use the identifier shown in your game profile.",
  };
}

function ConfiguredField({ field, value, onChange }: { field: TournamentRegistrationField; value: string | boolean; onChange: (value: string | boolean) => void }) {
  return (
    <FormField label={field.label} required={field.required}>
      {field.type === "checkbox" ? (
        <input type="checkbox" checked={value === true || value === "true"} required={field.required} onChange={(event) => onChange(event.target.checked)} className="mt-1 size-4 accent-purple-300" />
      ) : field.type === "select" ? (
        <Select required={field.required} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">Select {field.label}</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</Select>
      ) : (
        <Input type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"} required={field.required} value={typeof value === "boolean" ? String(value) : value} onChange={(event) => onChange(event.target.value)} />
      )}
    </FormField>
  );
}
