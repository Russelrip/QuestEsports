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
  email: string;
  discord: string;
  playerId: string;
  idNumber: string;
};

type RecruitmentFields = {
  applicationType: ApplicationType;
  fullName: string;
  phone: string;
  discord: string;
  game: string;
  playerId: string;
  idNumber: string;
  teamName: string;
  currentRosterSize: string;
  notes: string;
  womensLeagueInterest: boolean;
};

const emptyMember = (): RecruitmentMember => ({
  name: "",
  email: "",
  discord: "",
  playerId: "",
  idNumber: "",
});

const initialFields: RecruitmentFields = {
  applicationType: "solo_player",
  fullName: "",
  phone: "",
  discord: "",
  game: "VALORANT",
  playerId: "",
  idNumber: "",
  teamName: "",
  currentRosterSize: "",
  notes: "",
  womensLeagueInterest: false,
};

export default function RecruitmentForm() {
  const { user, isLoading: authLoading } = useAuth();
  const [fields, setFields] = useState(initialFields);
  const [members, setMembers] = useState<RecruitmentMember[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) {
      return;
    }

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
  ) => {
    setFields((current) => ({ ...current, [key]: value }));
  };

  const updateMember = (index: number, key: keyof RecruitmentMember, value: string) => {
    setMembers((current) =>
      current.map((member, memberIndex) =>
        memberIndex === index ? { ...member, [key]: value } : member
      )
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!event.currentTarget.checkValidity()) {
      setError("Please complete all required fields and accept the Privacy Policy.");
      event.currentTarget.reportValidity();
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
          currentRosterSize: fields.currentRosterSize || null,
          members,
        },
      });
      const data = await readApiResponse<{ message?: string }>(response);

      if (!response.ok || data.success === false) {
        setError(data.message || "Unable to submit recruitment application.");
        return;
      }

      setSuccess(
        "Your recruitment application has been submitted successfully. The Quest team will review it and contact you using your verified email or WhatsApp number."
      );
      setFields((current) => ({
        ...initialFields,
        fullName: current.fullName,
        phone: current.phone,
        discord: current.discord,
      }));
      setMembers([]);
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
          <p className="mt-3 text-sm text-slate-300">
            Recruitment applications are available to signed-in members with verified emails.
          </p>
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
          <p className="mt-3 text-sm text-slate-300">
            Only verified Quest accounts can submit recruitment applications.
          </p>
          <div className="mt-5">
            <ResendVerificationButton email={user.email} />
          </div>
        </Card>
      </Section>
    );
  }

  const teamApplication = fields.applicationType !== "solo_player";

  return (
    <Section className="pt-6">
      <div className="grid gap-6">
        <Card className="p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/80">Recruitment Open</p>
          <h2 className="mt-3 text-3xl text-white">Join the Quest community</h2>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300">
            Whether you are a solo player, an existing team, or an incomplete roster
            looking for teammates, we would love to have you join our community.
          </p>
          <p className="mt-4 text-sm text-slate-400">
            Female gamers interested in joining our Women&apos;s League can select the
            option below and{" "}
            <a
              href="https://www.instagram.com/questesportslk/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-200 hover:text-cyan-100"
            >
              send us a DM
            </a>{" "}
            for league-specific information.
          </p>
        </Card>

        <Card className="p-6 sm:p-8">
          <form className="grid gap-6" onSubmit={handleSubmit} noValidate>
            <fieldset>
              <legend>Application Type</legend>
              <FormField label="How are you joining?" htmlFor="applicationType" required>
                <Select
                  id="applicationType"
                  value={fields.applicationType}
                  onChange={(event) => {
                    const nextType = event.target.value as ApplicationType;
                    updateField("applicationType", nextType);
                    if (nextType === "solo_player") {
                      setMembers([]);
                    }
                  }}
                >
                  <option value="solo_player">Solo Player</option>
                  <option value="existing_team">Existing Team</option>
                  <option value="incomplete_team">Incomplete Team Looking for Players</option>
                </Select>
              </FormField>
            </fieldset>

            <fieldset>
              <legend>Applicant Details</legend>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Full Name" htmlFor="fullName" required>
                  <Input id="fullName" required value={fields.fullName} onChange={(event) => updateField("fullName", event.target.value)} />
                </FormField>
                <FormField label="Verified Email" htmlFor="verifiedEmail" hint="Taken from your verified Quest account.">
                  <Input id="verifiedEmail" type="email" disabled value={user.email} />
                </FormField>
                <FormField label="NIC" htmlFor="idNumber" required hint="Stored encrypted and used only for recruitment review.">
                  <Input id="idNumber" required value={fields.idNumber} onChange={(event) => updateField("idNumber", event.target.value)} />
                </FormField>
                <FormField label="WhatsApp Contact Number" htmlFor="phone" required>
                  <Input id="phone" type="tel" required value={fields.phone} onChange={(event) => updateField("phone", event.target.value)} />
                </FormField>
                <FormField label="Discord Username" htmlFor="discord" required>
                  <Input id="discord" required value={fields.discord} onChange={(event) => updateField("discord", event.target.value)} />
                </FormField>
                <FormField label="Primary Game" htmlFor="game" required>
                  <Input id="game" required value={fields.game} onChange={(event) => updateField("game", event.target.value)} />
                </FormField>
                <FormField label="In-Game Player ID" htmlFor="playerId" required className="sm:col-span-2">
                  <Input id="playerId" required placeholder="Username#Region" value={fields.playerId} onChange={(event) => updateField("playerId", event.target.value)} />
                </FormField>
              </div>
            </fieldset>

            {teamApplication ? (
              <fieldset>
                <legend>Team Details</legend>
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormField label="Team Name" htmlFor="teamName" required>
                    <Input id="teamName" required value={fields.teamName} onChange={(event) => updateField("teamName", event.target.value)} />
                  </FormField>
                  <FormField label="Current Roster Size" htmlFor="currentRosterSize" required>
                    <Input id="currentRosterSize" type="number" min="1" max="20" required value={fields.currentRosterSize} onChange={(event) => updateField("currentRosterSize", event.target.value)} />
                  </FormField>
                </div>

                <div className="mt-6 grid gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xl text-white">Team Members</h3>
                      <p className="mt-1 text-xs text-slate-400">Add each current roster member, including their NIC.</p>
                    </div>
                    <Button type="button" variant="secondary" onClick={() => setMembers((current) => [...current, emptyMember()])}>
                      Add Team Member
                    </Button>
                  </div>

                  {members.map((member, index) => (
                    <div key={index} className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h4 className="text-lg text-white">Team Member {index + 1}</h4>
                        <Button type="button" variant="danger" size="sm" onClick={() => setMembers((current) => current.filter((_, memberIndex) => memberIndex !== index))}>
                          Remove
                        </Button>
                      </div>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <FormField label="Full Name" required>
                          <Input required value={member.name} onChange={(event) => updateMember(index, "name", event.target.value)} />
                        </FormField>
                        <FormField label="Email Address" required>
                          <Input type="email" required value={member.email} onChange={(event) => updateMember(index, "email", event.target.value)} />
                        </FormField>
                        <FormField label="NIC" required hint="Stored encrypted.">
                          <Input required value={member.idNumber} onChange={(event) => updateMember(index, "idNumber", event.target.value)} />
                        </FormField>
                        <FormField label="Discord Username" required>
                          <Input required value={member.discord} onChange={(event) => updateMember(index, "discord", event.target.value)} />
                        </FormField>
                        <FormField label="In-Game Player ID" required className="sm:col-span-2">
                          <Input required value={member.playerId} onChange={(event) => updateMember(index, "playerId", event.target.value)} />
                        </FormField>
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <fieldset>
              <legend>Additional Information</legend>
              <FormField label="Tell us about yourself or your team" htmlFor="notes">
                <Textarea id="notes" rows={5} value={fields.notes} onChange={(event) => updateField("notes", event.target.value)} />
              </FormField>
              <label className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-300">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-cyan-300"
                  checked={fields.womensLeagueInterest}
                  onChange={(event) => updateField("womensLeagueInterest", event.target.checked)}
                />
                <span>I am interested in joining the Quest Women&apos;s League.</span>
              </label>
              <label className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-300">
                <input type="checkbox" required className="mt-1 size-4 accent-cyan-300" />
                <span>
                  I confirm these details are accurate and agree to the{" "}
                  <Link href="/privacy-policy" className="text-cyan-200 hover:text-cyan-100">Privacy Policy</Link>.
                </span>
              </label>
            </fieldset>

            {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
            {success ? <p role="status" className="text-sm text-emerald-300">{success}</p> : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Recruitment Application"}
            </Button>
          </form>
        </Card>
      </div>
    </Section>
  );
}
