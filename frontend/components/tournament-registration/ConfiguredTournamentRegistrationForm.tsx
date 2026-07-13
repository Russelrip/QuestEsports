"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useTeams } from "@/hooks/api/useTeams";
import { apiFetch } from "@/lib/auth";
import { PayHereCheckout, submitPayHereCheckout } from "@/lib/payments";
import type { Tournament, TournamentRegistrationField } from "@/lib/tournaments";

type MemberDraft = {
  name: string;
  email: string;
  discord: string;
  gameId: string;
  role: "PLAYER" | "SUBSTITUTE";
  additionalData: Record<string, string>;
};

type BankTransferReservation = {
  orderId: string;
  assignedSlotNumber: number;
  amount: number;
  currency: string;
  expiresAt: string;
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
  const [entryData, setEntryData] = useState<Record<string, string>>({});
  const [captainAdditionalData, setCaptainAdditionalData] = useState<Record<string, string>>({});
  const [teamLogo, setTeamLogo] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const entryFields = useMemo(() => (tournament.registrationFields || []).filter((field) => field.scope === "entry"), [tournament.registrationFields]);
  const memberFields = useMemo(() => (tournament.registrationFields || []).filter((field) => field.scope === "member"), [tournament.registrationFields]);
  const maximumAdditionalPlayers = Math.max(0, (tournament.maxRosterSize || tournament.teamSize || 1) + (tournament.maxSubstitutes || 0) - 1);

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

  const updateMember = (index: number, updates: Partial<MemberDraft>) => {
    setMembers((current) => current.map((member, memberIndex) => memberIndex === index ? { ...member, ...updates } : member));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    setLoading(true);
    setError("");
    setSuccess("");

    const body = new FormData();
    Object.entries(form).forEach(([key, value]) => body.append(key, String(value)));
    body.append("additionalData", JSON.stringify(entryData));
    body.append("captainAdditionalData", JSON.stringify(captainAdditionalData));
    body.append("members", JSON.stringify(members));
    if (teamLogo) body.append("teamLogo", teamLogo);

    try {
      const response = await apiFetch(`/api/tournaments/${tournament.slug}/registrations`, { method: "POST", body });
      const data = (await response.json()) as {
        success?: boolean;
        message?: string;
        checkout?: PayHereCheckout | null;
        bankTransfer?: BankTransferReservation | null;
      };
      if (!response.ok || !data.success) throw new Error(data.message || "Registration could not be submitted.");
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
      setError(nextError instanceof Error ? nextError.message : "Registration could not be submitted.");
    } finally {
      setLoading(false);
    }
  };

  if (isLoading || !user) return <Card className="p-8"><p className="text-slate-300">Loading your account…</p></Card>;
  if (!user.emailVerified) {
    return <Card className="p-8"><h2 className="text-3xl text-white">Verify your email first</h2><p className="mt-3 text-sm text-slate-300">A verified account is required before registering.</p><div className="mt-5"><ResendVerificationButton email={user.email} /></div></Card>;
  }
  if (!tournament.registrationPaymentAvailable) {
    return <Card className="p-8"><h2 className="text-3xl text-white">Paid registration is not available yet</h2><p className="mt-3 text-sm leading-7 text-slate-300">Quest has not connected an online payment provider. No payment or registration draft has been created.</p><Link href={`/tournaments/${tournament.slug}`} className={buttonClassName({ variant: "secondary", className: "mt-5" })}>Return to tournament</Link></Card>;
  }

  return (
    <form className="grid gap-6" onSubmit={submit}>
      <Card className="p-6 sm:p-8">
        <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/80">{tournament.entryType === "solo" ? "Solo Entry" : "Team Entry"}</p>
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
          <FormField label="Reuse a saved team" htmlFor="savedTeam">
            <Select id="savedTeam" defaultValue="" onChange={(event) => {
              const team = savedTeams.find((candidate) => candidate.id === event.target.value);
              if (!team) return;
              setForm((current) => ({ ...current, teamName: team.name, teamTag: team.teamTag || "", country: team.country || "Sri Lanka", organizationRequested: Boolean(team.organizationRequested) }));
              setMembers(team.members.filter((member) => member.role !== "CAPTAIN" && member.role !== "COACH").map((member) => ({ name: member.name, email: member.email, discord: member.discord || "", gameId: member.riotId || "", role: member.role === "SUBSTITUTE" ? "SUBSTITUTE" : "PLAYER", additionalData: {} })));
            }}>
              <option value="">Start with a new entry</option>
              {savedTeams.filter((team) => team.isCaptain).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </Select>
          </FormField>
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
          {memberFields.map((field) => <ConfiguredField key={field.key} field={field} value={captainAdditionalData[field.key] || ""} onChange={(value) => setCaptainAdditionalData((current) => ({ ...current, [field.key]: value }))} />)}
        </fieldset>

        {entryFields.length > 0 ? <fieldset className="grid gap-5 sm:grid-cols-2"><legend className="mb-4 text-xl text-white sm:col-span-2">Game details</legend>{entryFields.map((field) => <ConfiguredField key={field.key} field={field} value={entryData[field.key] || ""} onChange={(value) => setEntryData((current) => ({ ...current, [field.key]: value }))} />)}</fieldset> : null}
      </Card>

      {tournament.entryType === "team" ? (
        <Card className="p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4"><div><h3 className="text-2xl text-white">Roster</h3><p className="mt-2 text-sm text-slate-400">Captain plus {minimumAdditionalPlayers}-{maximumAdditionalPlayers} additional players.</p></div>{members.length < maximumAdditionalPlayers ? <Button type="button" variant="secondary" onClick={() => setMembers((current) => [...current, emptyMember()])}>Add player</Button> : null}</div>
          <div className="mt-6 grid gap-5">
            {members.map((member, index) => (
              <div key={index} className="rounded-[22px] border border-white/10 bg-black/20 p-5">
                <div className="mb-4 flex items-center justify-between"><h4 className="text-lg text-white">Roster member {index + 2}</h4>{members.length > minimumAdditionalPlayers ? <button type="button" className="text-sm text-rose-300" onClick={() => setMembers((current) => current.filter((_, memberIndex) => memberIndex !== index))}>Remove</button> : null}</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Name" required><Input required value={member.name} onChange={(event) => updateMember(index, { name: event.target.value })} /></FormField>
                  <FormField label="Email" required><Input type="email" required value={member.email} onChange={(event) => updateMember(index, { email: event.target.value })} /></FormField>
                  <FormField label="Discord"><Input value={member.discord} onChange={(event) => updateMember(index, { discord: event.target.value })} /></FormField>
                  <FormField label="Role"><Select value={member.role} onChange={(event) => updateMember(index, { role: event.target.value as MemberDraft["role"] })}><option value="PLAYER">Player</option><option value="SUBSTITUTE">Substitute</option></Select></FormField>
                  {memberFields.map((field) => <ConfiguredField key={field.key} field={field} value={member.additionalData[field.key] || ""} onChange={(value) => updateMember(index, { additionalData: { ...member.additionalData, [field.key]: value } })} />)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="grid gap-4 p-6 sm:p-8">
        <label className="flex gap-3 text-sm text-slate-300"><input type="checkbox" required checked={form.rulebookAccepted} onChange={(event) => setForm((current) => ({ ...current, rulebookAccepted: event.target.checked }))} /><span>I have read and accept the tournament rulebook and competition rules.</span></label>
        <label className="flex gap-3 text-sm text-slate-300"><input type="checkbox" required checked={form.falsityWarningAccepted} onChange={(event) => setForm((current) => ({ ...current, falsityWarningAccepted: event.target.checked }))} /><span>I confirm that the registration information is accurate.</span></label>
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-300">{success} <Link className="underline" href="/profile">Open dashboard</Link></p> : null}
        <Button type="submit" disabled={loading}>
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

function getRegistrationFeeLabel(tournament: Tournament) {
  if (!tournament.registrationFee?.amount) return "Free registration";
  const amounts = (tournament.registrationFeeTiers || []).map((tier) => tier.amount);
  if (amounts.length > 0) {
    return `${tournament.registrationFee.currency} ${Math.min(...amounts).toFixed(2)}–${Math.max(...amounts).toFixed(2)} by slot`;
  }
  return `${tournament.registrationFee.currency} ${tournament.registrationFee.amount.toFixed(2)}`;
}

function ConfiguredField({ field, value, onChange }: { field: TournamentRegistrationField; value: string; onChange: (value: string) => void }) {
  return (
    <FormField label={field.label} required={field.required}>
      {field.type === "select" ? (
        <Select required={field.required} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Select {field.label}</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</Select>
      ) : (
        <Input type={field.type === "number" ? "number" : "text"} required={field.required} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </FormField>
  );
}
