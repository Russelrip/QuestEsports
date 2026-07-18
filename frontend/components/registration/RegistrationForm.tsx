"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { Select } from "@/components/ui/select";
import { ProfileSkeleton } from "@/components/ui/skeleton";
import { useToastStore } from "@/hooks/useToastStore";
import { teamCountries } from "@/lib/countries";
import {
  type CreateTeamMemberInput,
  createSavedTeam,
} from "@/lib/teams";

const emptyMember = (): CreateTeamMemberInput => ({ name: "", email: "" });

const formatFileSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export default function RegistrationForm() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const showToast = useToastStore((state) => state.showToast);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [teamTag, setTeamTag] = useState("");
  const [teamLogo, setTeamLogo] = useState<File | null>(null);
  const [members, setMembers] = useState<CreateTeamMemberInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const captainName = useMemo(
    () =>
      [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
      user?.username ||
      "Team Captain",
    [user]
  );

  const updateMember = (
    index: number,
    key: keyof CreateTeamMemberInput,
    value: string
  ) => {
    setMembers((current) =>
      current.map((member, memberIndex) =>
        memberIndex === index ? { ...member, [key]: value } : member
      )
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const result = await createSavedTeam({
        name,
        country,
        teamTag,
        organizationRequested: false,
        teamLogo,
        members,
      });
      showToast({
        tone: "success",
        title: "Team created",
        description: result.message,
      });
      router.push(`/profile?tab=teams&team=${encodeURIComponent(result.team.id)}&created=1`);
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : "Could not create this team.";
      setError(message);
      showToast({
        tone: "error",
        title: "Unable to create team",
        description: message,
      });
    } finally {
      setSubmitting(false);
    }
  };

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
        <Card className="mx-auto max-w-3xl p-6 sm:p-8">
          <h2 className="text-3xl text-white">Create Team</h2>
          <p className="mt-3 text-sm text-slate-400">
            Sign in before creating and managing a team.
          </p>
          <div className="mt-6">
            <Link
              href="/login?redirect=%2Fregistration"
              className={buttonClassName({})}
            >
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
        <Card className="mx-auto max-w-3xl p-6 sm:p-8">
          <h2 className="text-3xl text-white">Verify your email first</h2>
          <p className="mt-3 text-sm text-slate-300">
            Team creation is available to verified accounts.
          </p>
          <div className="mt-5">
            <ResendVerificationButton email={user.email} />
          </div>
        </Card>
      </Section>
    );
  }

  return (
    <Section className="pt-6">
      <Card className="mx-auto max-w-5xl overflow-hidden p-0">
        <form onSubmit={handleSubmit}>
          <div className="flex items-start justify-between border-b border-white/10 px-5 py-6 sm:px-8">
            <div>
              <h2 className="text-3xl text-cyan-200">Create Team</h2>
              <p className="mt-2 text-xs uppercase tracking-[0.1em] text-slate-500">
                All fields are required unless specified optional
              </p>
            </div>
            <Link
              href="/profile"
              aria-label="Close team creation"
              className="text-3xl leading-none text-slate-500 transition hover:text-white"
            >
              ×
            </Link>
          </div>

          <div className="grid gap-6 px-5 py-6 sm:px-8">
            <FormField label="Name" htmlFor="teamName" required>
              <Input
                id="teamName"
                required
                placeholder="Enter Team Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>

            <FormField label="Country" htmlFor="country" required>
              <Select
                id="country"
                required
                value={country}
                onChange={(event) => setCountry(event.target.value)}
              >
                <option value="">Select Country</option>
                {teamCountries.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Tag" htmlFor="teamTag" required>
              <Input
                id="teamTag"
                required
                maxLength={12}
                placeholder="Enter Team Tag"
                value={teamTag}
                onChange={(event) => setTeamTag(event.target.value)}
              />
            </FormField>

            <FormField
              label="Team Logo"
              htmlFor="teamLogo"
              hint="Please upload a square image, ideally 300×300 (optional)"
            >
              <input
                ref={logoInputRef}
                id="teamLogo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) =>
                  setTeamLogo(event.target.files?.[0] || null)
                }
              />
              <div className="flex min-h-12 items-center justify-between rounded-xl border border-white/15 bg-black/20 pl-4">
                <span className="min-w-0 truncate pr-3 text-sm text-slate-300">
                  {teamLogo
                    ? `${teamLogo.name} (${formatFileSize(teamLogo.size)})`
                    : "Choose file to upload"}
                </span>
                <label
                  htmlFor="teamLogo"
                  className="cursor-pointer self-stretch rounded-r-xl bg-cyan-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-cyan-400"
                >
                  Browse
                </label>
              </div>
            </FormField>

            <section className="grid gap-4 pt-2">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Members
                </h3>
                <p className="mt-1 text-xs uppercase tracking-[0.08em] text-slate-500">
                  An invitation email will be sent to each team member.
                </p>
              </div>

              <div className="grid gap-4 rounded-xl border border-white/10 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Name">
                    <Input value={captainName} readOnly disabled />
                  </FormField>
                  <FormField label="Email">
                    <Input value={user.email} readOnly disabled />
                  </FormField>
                </div>
              </div>

              {members.map((member, index) => (
                <div
                  key={index}
                  className="grid gap-4 rounded-xl border border-white/10 p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">
                      Member {index + 2}
                    </p>
                    <button
                      type="button"
                      className="text-sm text-rose-300 transition hover:text-rose-200"
                      onClick={() =>
                        setMembers((current) =>
                          current.filter((_, memberIndex) => memberIndex !== index)
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Name" required>
                      <Input
                        required
                        placeholder="Member name"
                        value={member.name}
                        onChange={(event) =>
                          updateMember(index, "name", event.target.value)
                        }
                      />
                    </FormField>
                    <FormField label="Email" required>
                      <Input
                        required
                        type="email"
                        placeholder="member@example.com"
                        value={member.email}
                        onChange={(event) =>
                          updateMember(index, "email", event.target.value)
                        }
                      />
                    </FormField>
                  </div>
                </div>
              ))}

              <button
                type="button"
                className="mx-auto flex items-center gap-3 px-5 py-2 text-sm font-semibold uppercase text-cyan-300 transition hover:text-cyan-100"
                onClick={() => setMembers((current) => [...current, emptyMember()])}
                disabled={members.length >= 20}
              >
                <span className="text-2xl font-light">+</span> Add
              </button>
            </section>

            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          </div>

          <div className="flex justify-end gap-4 border-t border-white/10 bg-black/20 px-5 py-5 sm:px-8">
            <Link
              href="/profile"
              className={buttonClassName({ variant: "secondary" })}
            >
              Cancel
            </Link>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </Card>
    </Section>
  );
}
