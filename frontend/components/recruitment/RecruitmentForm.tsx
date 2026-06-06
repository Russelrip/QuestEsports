"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/auth";
import { readApiResponse } from "@/lib/api";

type ApplicationType = "solo_player" | "existing_team" | "incomplete_team";

type RecruitmentMember = {
  name: string;
  ign: string;
  playerId: string;
  discord: string;
  email: string;
  phone: string;
  role: "player" | "substitute";
};

type RecruitmentFields = {
  applicationType: ApplicationType;
  fullName: string;
  ign: string;
  birthday: string;
  gender: string;
  phone: string;
  discord: string;
  games: string[];
  otherGame: string;
  peakAndCurrentRank: string;
  playerId: string;
  tournamentExperience: string;
  previouslyInOrganization: boolean;
  previousOrganization: string;
  canAttendLan: boolean;
  teamName: string;
  teamLogoUrl: string;
  currentRosterSize: string;
  additionalMembers: string;
  notes: string;
  declarationAccepted: boolean;
};

const games = [
  "VALORANT",
  "Mobile Legends: Bang Bang",
  "PUBG Mobile",
  "League of Legends",
  "Counter-Strike 2",
  "Dota 2",
  "Apex Legends",
  "Call of Duty Mobile",
  "Free Fire",
];

const rules = [
  "Respect all players, staff members, and community members.",
  "Toxic behavior, harassment, discrimination, or hate speech will not be tolerated.",
  "Maintain good sportsmanship during tournaments and community activities.",
  "Cheating, exploiting bugs, account sharing, and unauthorized software are prohibited.",
  "Follow tournament rules and team management decisions.",
  "Represent Quest Esports professionally online and offline.",
  "Attend scheduled practices, meetings, and official events whenever possible.",
];

const emptyMember = (): RecruitmentMember => ({
  name: "",
  ign: "",
  playerId: "",
  discord: "",
  email: "",
  phone: "",
  role: "player",
});

const initialFields: RecruitmentFields = {
  applicationType: "solo_player",
  fullName: "",
  ign: "",
  birthday: "",
  gender: "",
  phone: "",
  discord: "",
  games: [],
  otherGame: "",
  peakAndCurrentRank: "",
  playerId: "",
  tournamentExperience: "",
  previouslyInOrganization: false,
  previousOrganization: "",
  canAttendLan: false,
  teamName: "",
  teamLogoUrl: "",
  currentRosterSize: "",
  additionalMembers: "",
  notes: "",
  declarationAccepted: false,
};

const checkboxClassName = "mt-1 size-4 shrink-0 accent-cyan-300";
const choiceClassName =
  "flex items-start gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-300";

export default function RecruitmentForm() {
  const { user, isLoading: authLoading } = useAuth();
  const [fields, setFields] = useState(initialFields);
  const [members, setMembers] = useState<RecruitmentMember[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFields((current) => ({
      ...current,
      fullName: current.fullName || [user.firstName, user.lastName].filter(Boolean).join(" "),
      phone: current.phone || user.phone || "",
      discord: current.discord || user.discordTag || "",
    }));
  }, [user]);

  const updateField = <Key extends keyof RecruitmentFields>(
    key: Key,
    value: RecruitmentFields[Key]
  ) => setFields((current) => ({ ...current, [key]: value }));

  const updateMember = (index: number, key: keyof RecruitmentMember, value: string) => {
    setMembers((current) =>
      current.map((member, memberIndex) =>
        memberIndex === index ? { ...member, [key]: value } : member
      )
    );
  };

  const setApplicationType = (applicationType: ApplicationType) => {
    updateField("applicationType", applicationType);
    setMembers(
      applicationType === "existing_team"
        ? Array.from({ length: 4 }, emptyMember)
        : applicationType === "incomplete_team"
          ? [emptyMember()]
          : []
    );
  };

  const toggleGame = (game: string) => {
    updateField(
      "games",
      fields.games.includes(game)
        ? fields.games.filter((selected) => selected !== game)
        : [...fields.games, game]
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!event.currentTarget.checkValidity()) {
      setError("Please complete all required fields.");
      event.currentTarget.reportValidity();
      return;
    }
    if (fields.games.length === 0 && !fields.otherGame.trim()) {
      setError("Select at least one game.");
      return;
    }
    if (!user?.emailVerified) {
      setError("Verify your email before submitting a recruitment application.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiFetch("/api/recruitment-applications", {
        method: "POST",
        json: {
          ...fields,
          games: [...fields.games, fields.otherGame.trim()].filter(Boolean),
          currentRosterSize: fields.currentRosterSize || null,
          members,
        },
      });
      const data = await readApiResponse<{ message?: string }>(response);
      if (!response.ok || data.success === false) {
        setError(data.message || "Unable to submit recruitment application.");
        return;
      }
      setSuccess(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (requestError) {
      console.error("Recruitment submission failed:", requestError);
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return <Section className="pt-6"><Card className="h-48 animate-pulse" /></Section>;
  }

  if (!user) {
    return (
      <Section className="pt-6">
        <Card className="p-6 sm:p-8">
          <h2 className="text-3xl text-white">Sign in to join Quest</h2>
          <p className="mt-3 text-sm text-slate-300">Recruitment applications are available to signed-in members with verified emails.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/login?redirect=%2Fjoin" className={buttonClassName({})}>Login</Link>
            <Link href="/signup" className={buttonClassName({ variant: "secondary" })}>Create Account</Link>
          </div>
        </Card>
      </Section>
    );
  }

  if (!user.emailVerified) {
    return (
      <Section className="pt-6">
        <Card className="p-6 sm:p-8">
          <h2 className="text-3xl text-white">Verify your email to apply</h2>
          <p className="mt-3 text-sm text-slate-300">Only verified Quest accounts can submit recruitment applications.</p>
          <div className="mt-5"><ResendVerificationButton email={user.email} /></div>
        </Card>
      </Section>
    );
  }

  if (success) return <WelcomeCard />;

  const teamApplication = fields.applicationType !== "solo_player";

  return (
    <Section className="pt-6">
      <div className="grid gap-6">
        <Card className="p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Recruitment Open</p>
          <h2 className="mt-3 text-3xl text-white">Quest Esports Recruitment Form</h2>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300">
            We are recruiting individual players and existing teams across multiple esports titles.
            Applications are reviewed by management, and shortlisted applicants will be contacted.
          </p>
          <div className="mt-5 flex flex-wrap gap-3 text-sm">
            <a className={buttonClassName({ variant: "secondary", size: "sm" })} href="https://discord.gg/pYAeWjKQn3" target="_blank" rel="noreferrer">Join Discord</a>
            <a className={buttonClassName({ variant: "secondary", size: "sm" })} href="tel:0761195666">076 119 5666</a>
            <a className={buttonClassName({ variant: "secondary", size: "sm" })} href="tel:0767186060">076 718 6060</a>
          </div>
        </Card>

        <Card className="p-6 sm:p-8">
          <form className="grid gap-7" onSubmit={handleSubmit} noValidate>
            <fieldset>
              <legend>1. Player Details</legend>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Full Name (Team Leader / Solo Player)" htmlFor="fullName" required>
                  <Input id="fullName" required value={fields.fullName} onChange={(event) => updateField("fullName", event.target.value)} />
                </FormField>
                <FormField label="In-Game Name (IGN)" htmlFor="ign" required>
                  <Input id="ign" required value={fields.ign} onChange={(event) => updateField("ign", event.target.value)} />
                </FormField>
                <FormField label="Birthday" htmlFor="birthday" required>
                  <Input id="birthday" type="date" required value={fields.birthday} onChange={(event) => updateField("birthday", event.target.value)} />
                </FormField>
                <FormField label="Gender" htmlFor="gender" required>
                  <Select id="gender" required value={fields.gender} onChange={(event) => updateField("gender", event.target.value)}>
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </Select>
                </FormField>
                <FormField label="Discord Username" htmlFor="discord" required>
                  <Input id="discord" required value={fields.discord} onChange={(event) => updateField("discord", event.target.value)} />
                </FormField>
                <FormField label="Contact Number" htmlFor="phone" required>
                  <Input id="phone" type="tel" required value={fields.phone} onChange={(event) => updateField("phone", event.target.value)} />
                </FormField>
                <FormField label="Verified Email" htmlFor="verifiedEmail" hint="Taken from your verified Quest account.">
                  <Input id="verifiedEmail" type="email" disabled value={user.email} />
                </FormField>
                <FormField label="Game ID" htmlFor="playerId" required hint="Make sure this is the correct ID.">
                  <Input id="playerId" required value={fields.playerId} onChange={(event) => updateField("playerId", event.target.value)} />
                </FormField>
              </div>

              <FormField label="Games You Play" required>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {games.map((game) => (
                    <label key={game} className={choiceClassName}>
                      <input type="checkbox" className={checkboxClassName} checked={fields.games.includes(game)} onChange={() => toggleGame(game)} />
                      <span>{game}</span>
                    </label>
                  ))}
                </div>
              </FormField>
              <FormField label="Other Game" htmlFor="otherGame">
                <Input id="otherGame" value={fields.otherGame} onChange={(event) => updateField("otherGame", event.target.value)} />
              </FormField>
              <FormField label="Peak Rank, Current Rank and Game Name" htmlFor="rank" required>
                <Input id="rank" required value={fields.peakAndCurrentRank} onChange={(event) => updateField("peakAndCurrentRank", event.target.value)} />
              </FormField>
              <FormField label="Previous Tournament Experience / Achievements" htmlFor="experience">
                <Textarea id="experience" rows={4} value={fields.tournamentExperience} onChange={(event) => updateField("tournamentExperience", event.target.value)} />
              </FormField>

              <YesNo label="Have you previously played for an esports organization or clan?" value={fields.previouslyInOrganization} onChange={(value) => updateField("previouslyInOrganization", value)} />
              {fields.previouslyInOrganization ? (
                <FormField label="Organization / Clan Name" htmlFor="previousOrganization" required>
                  <Input id="previousOrganization" required value={fields.previousOrganization} onChange={(event) => updateField("previousOrganization", event.target.value)} />
                </FormField>
              ) : null}
              <YesNo label="Are you able to attend LAN events?" value={fields.canAttendLan} onChange={(value) => updateField("canAttendLan", value)} />

              <FormField label="Application Type" htmlFor="applicationType" required hint="Teams with fewer than five members should select Incomplete Team.">
                <Select id="applicationType" value={fields.applicationType} onChange={(event) => setApplicationType(event.target.value as ApplicationType)}>
                  <option value="solo_player">Solo Player</option>
                  <option value="existing_team">Team (5 members or more)</option>
                  <option value="incomplete_team">Incomplete Team (2-4 members)</option>
                </Select>
              </FormField>
            </fieldset>

            {teamApplication ? (
              <fieldset>
                <legend>2. {fields.applicationType === "existing_team" ? "Team Registration" : "Incomplete Team Registration"}</legend>
                <p className="text-sm leading-7 text-slate-400">
                  {fields.applicationType === "existing_team"
                    ? "Register your complete roster with at least five active players, including the team leader above."
                    : "Tell us about your current roster so Quest Esports can help connect you with suitable players."}
                </p>
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField label="Team Name" htmlFor="teamName" required>
                    <Input id="teamName" required value={fields.teamName} onChange={(event) => updateField("teamName", event.target.value)} />
                  </FormField>
                  <FormField label="Number of Active Players" htmlFor="currentRosterSize" required>
                    <Input id="currentRosterSize" type="number" min={fields.applicationType === "existing_team" ? 5 : 2} max={fields.applicationType === "existing_team" ? 20 : 4} required value={fields.currentRosterSize} onChange={(event) => updateField("currentRosterSize", event.target.value)} />
                  </FormField>
                  <FormField label="Team Logo Link" htmlFor="teamLogoUrl" hint="Optional link to a Drive, Discord, or image-hosting file." className="sm:col-span-2">
                    <Input id="teamLogoUrl" type="url" value={fields.teamLogoUrl} onChange={(event) => updateField("teamLogoUrl", event.target.value)} />
                  </FormField>
                </div>

                <div className="grid gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xl text-white">Current Members</h3>
                      <p className="mt-1 text-xs text-slate-400">The team leader is already included from section 1.</p>
                    </div>
                    <Button type="button" variant="secondary" disabled={fields.applicationType === "incomplete_team" && members.length >= 3} onClick={() => setMembers((current) => [...current, emptyMember()])}>Add Member</Button>
                  </div>
                  {members.map((member, index) => (
                    <MemberFields key={index} member={member} number={index + 2} canRemove={members.length > (fields.applicationType === "existing_team" ? 4 : 1)} onUpdate={(key, value) => updateMember(index, key, value)} onRemove={() => setMembers((current) => current.filter((_, memberIndex) => memberIndex !== index))} />
                  ))}
                </div>
                {fields.applicationType === "existing_team" ? (
                  <FormField label="More Than 7 Members" htmlFor="additionalMembers" hint="Mention any additional member details here.">
                    <Textarea id="additionalMembers" rows={4} value={fields.additionalMembers} onChange={(event) => updateField("additionalMembers", event.target.value)} />
                  </FormField>
                ) : null}
              </fieldset>
            ) : null}

            <fieldset>
              <legend>3. Declaration &amp; Rules</legend>
              <ul className="grid gap-2 text-sm leading-7 text-slate-300">
                {rules.map((rule) => <li key={rule} className="rounded-xl bg-white/4 px-4 py-2">{rule}</li>)}
              </ul>
              <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/5 p-4 text-sm leading-7 text-slate-300">
                <h3 className="text-lg text-white">Membership Commitment</h3>
                <p className="mt-2">Members are expected to remain with Quest Esports for a minimum of two years and should not represent another esports organization without prior management approval. Early departures must be discussed with management in advance.</p>
              </div>
              <FormField label="Anything Else You Would Like Us to Know?" htmlFor="notes">
                <Textarea id="notes" rows={4} value={fields.notes} onChange={(event) => updateField("notes", event.target.value)} />
              </FormField>
              <label className={choiceClassName}>
                <input type="checkbox" required className={checkboxClassName} checked={fields.declarationAccepted} onChange={(event) => updateField("declarationAccepted", event.target.checked)} />
                <span>I confirm that I have read, understood, and agree to abide by the Quest Esports rules, regulations, and membership requirements.</span>
              </label>
              <label className={choiceClassName}>
                <input type="checkbox" required className={checkboxClassName} />
                <span>I confirm these details are accurate and agree to the <Link href="/privacy-policy" className="text-cyan-200 hover:text-cyan-100">Privacy Policy</Link>.</span>
              </label>
            </fieldset>

            {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
            <Button type="submit" disabled={submitting}>{submitting ? "Submitting..." : "Submit Recruitment Application"}</Button>
          </form>
        </Card>
      </div>
    </Section>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium text-slate-200">{label}<span className="ml-1 text-cyan-300">*</span></p>
      <div className="flex gap-3">
        <label className={choiceClassName}><input type="radio" checked={value} onChange={() => onChange(true)} /><span>Yes</span></label>
        <label className={choiceClassName}><input type="radio" checked={!value} onChange={() => onChange(false)} /><span>No</span></label>
      </div>
    </div>
  );
}

function MemberFields({ member, number, canRemove, onUpdate, onRemove }: { member: RecruitmentMember; number: number; canRemove: boolean; onUpdate: (key: keyof RecruitmentMember, value: string) => void; onRemove: () => void }) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-white/5 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-lg text-white">Player {number}</h4>
        {canRemove ? <Button type="button" variant="danger" size="sm" onClick={onRemove}>Remove</Button> : null}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Full Name" required><Input required value={member.name} onChange={(event) => onUpdate("name", event.target.value)} /></FormField>
        <FormField label="In-Game Name (IGN)" required><Input required value={member.ign} onChange={(event) => onUpdate("ign", event.target.value)} /></FormField>
        <FormField label="Game ID" required><Input required value={member.playerId} onChange={(event) => onUpdate("playerId", event.target.value)} /></FormField>
        <FormField label="Discord Username" required><Input required value={member.discord} onChange={(event) => onUpdate("discord", event.target.value)} /></FormField>
        <FormField label="Email Address" required><Input required type="email" value={member.email} onChange={(event) => onUpdate("email", event.target.value)} /></FormField>
        <FormField label="WhatsApp Number" required><Input required type="tel" value={member.phone} onChange={(event) => onUpdate("phone", event.target.value)} /></FormField>
        <FormField label="Roster Role">
          <Select value={member.role} onChange={(event) => onUpdate("role", event.target.value)}>
            <option value="player">Player</option><option value="substitute">Substitute</option>
          </Select>
        </FormField>
      </div>
    </div>
  );
}

function WelcomeCard() {
  return (
    <Section className="pt-6">
      <Card className="p-6 sm:p-8">
        <p className="text-xs uppercase tracking-[0.28em] text-emerald-300/80">Application Submitted</p>
        <h2 className="mt-3 text-3xl text-white">Welcome to Quest Esports LK</h2>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">Thank you for your application. We look forward to growing, competing, and achieving great things together. Management will contact shortlisted applicants.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <a className={buttonClassName({ variant: "secondary" })} href="https://discord.gg/pYAeWjKQn3" target="_blank" rel="noreferrer">Join Discord</a>
          <a className={buttonClassName({ variant: "secondary" })} href="https://ingame.gg/organisations/questesports.lk" target="_blank" rel="noreferrer">Register on Gamer.LK</a>
          <a className={buttonClassName({ variant: "secondary" })} href="https://chat.whatsapp.com/G8XZXgYC4Ep1VYw1Zg5PIf?s=sh&p=i&mlu=1&amv=2" target="_blank" rel="noreferrer">Join WhatsApp Community</a>
          <a className={buttonClassName({ variant: "secondary" })} href="https://forms.gle/mueagtUtcrF9Uxdv7" target="_blank" rel="noreferrer">Order Clan Jersey</a>
        </div>
      </Card>
    </Section>
  );
}
