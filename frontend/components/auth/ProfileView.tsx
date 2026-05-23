"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiFetch, apiFetchJson, getApiErrorMessage } from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LoadingState } from "@/components/ui/loading-state";
import { useTeams } from "@/hooks/api/useTeams";
import { useToastStore } from "@/hooks/useToastStore";
import { getInitials } from "@/lib/utils";

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required."),
  lastName: z.string().min(1, "Last name is required."),
  username: z.string().min(1, "Username is required."),
  email: z.string(),
  phone: z.string().optional(),
  discordTag: z.string().optional(),
});

const emailChangeSchema = z.object({
  newEmail: z.string().email("Please enter a valid email address."),
  currentPassword: z.string().min(1, "Current password is required."),
});

type ProfileFormValues = z.infer<typeof profileSchema>;
type EmailChangeValues = z.infer<typeof emailChangeSchema>;

const formatMemberRole = (role: string, memberOrder: number) => {
  if (role === "CAPTAIN") {
    return "Captain";
  }
  if (role === "COACH") {
    return "Coach";
  }
  return `${role === "PLAYER" ? "Player" : "Substitute"} ${memberOrder}`;
};

export default function ProfileView() {
  const router = useRouter();
  const { user, refreshUser, logout, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<"account" | "teams">("account");
  const { data: teamsData, loading: teamsLoading, error: teamsError } = useTeams(Boolean(user));
  const showToast = useToastStore((state) => state.showToast);
  const teams = teamsData ?? [];

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      username: "",
      email: "",
      phone: "",
      discordTag: "",
    },
  });

  const emailForm = useForm<EmailChangeValues>({
    resolver: zodResolver(emailChangeSchema),
    defaultValues: {
      newEmail: "",
      currentPassword: "",
    },
  });

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
      return;
    }

    if (user) {
      profileForm.reset({
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        username: user.username || "",
        email: user.email || "",
        phone: user.phone || "",
        discordTag: user.discordTag || "",
      });
    }
  }, [isLoading, profileForm, router, user]);

  if (isLoading) {
    return (
      <section className="py-10">
        <Container>
          <LoadingState title="Loading profile" description="Checking your account and saved teams." />
        </Container>
      </section>
    );
  }

  if (!user) {
    return null;
  }

  const initials = getInitials(user.firstName, user.lastName, user.username);

  const submitProfile = profileForm.handleSubmit(async (values) => {
    try {
      const response = await apiFetch(`/api/users/${user.id}`, {
        method: "PATCH",
        json: {
          firstName: values.firstName,
          lastName: values.lastName,
          username: values.username,
          phone: values.phone,
          discordTag: values.discordTag,
        },
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        profileForm.setError("root", { message: data.message || "Failed to update profile." });
        return;
      }

      refreshUser(data.user);
      profileForm.setError("root", { message: "Profile updated successfully." });
      showToast({ tone: "success", title: "Profile updated" });
    } catch (error) {
      console.error("Profile update failed:", error);
      profileForm.setError("root", { message: "Something went wrong while updating your profile." });
      showToast({ tone: "error", title: "Profile update failed" });
    }
  });

  const submitEmailChange = emailForm.handleSubmit(async (values) => {
    try {
      const { response, data } = await apiFetchJson<{
        success?: boolean;
        message?: string;
        user?: typeof user;
        details?: {
          fieldErrors?: Partial<Record<"newEmail" | "currentPassword", string>>;
        };
      }>("/api/email-change/request", {
        method: "POST",
        json: values,
      });

      const errorMessage = getApiErrorMessage(response, data, "Failed to request email change.");
      if (errorMessage) {
        const fieldErrors = data.details?.fieldErrors ?? {};
        for (const [key, value] of Object.entries(fieldErrors)) {
          emailForm.setError(key as keyof EmailChangeValues, { message: value });
        }
        if (Object.keys(fieldErrors).length === 0) {
          emailForm.setError("root", { message: errorMessage });
        }
        return;
      }

      if (data.user) {
        refreshUser(data.user);
      }
      emailForm.reset();
      emailForm.setError("root", {
        message: data.message || "We sent a confirmation link to your new email address.",
      });
      showToast({ tone: "success", title: "Email change requested" });
    } catch (error) {
      console.error("Email change request failed:", error);
      emailForm.setError("root", { message: "Something went wrong while requesting the email change." });
      showToast({ tone: "error", title: "Email change failed" });
    }
  });

  return (
    <section className="py-8 sm:py-12">
      <Container>
        <div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
          <Card className="p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="flex size-16 items-center justify-center rounded-[24px] bg-[linear-gradient(135deg,rgba(139,92,246,0.95),rgba(34,211,238,0.72))] text-lg font-bold text-white">
                {initials}
              </div>
              <div>
                <Badge className="border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
                  {user.role === "admin" ? "Admin Account" : "Player Account"}
                </Badge>
                <h2 className="mt-4 text-3xl text-white">
                  {user.firstName} {user.lastName}
                </h2>
                <p className="mt-2 text-sm text-slate-400">@{user.username}</p>
              </div>
            </div>

            <div className="mt-8 grid gap-4">
              <div className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Email</p>
                <p className="mt-2 text-sm text-white">{user.email}</p>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Verification</p>
                <p className="mt-2 text-sm text-white">{user.emailVerified ? "Verified" : "Not verified"}</p>
              </div>
            </div>

            {user.pendingEmail ? (
              <div className="mt-6 rounded-[24px] border border-amber-300/20 bg-amber-400/8 p-5 text-sm text-slate-200">
                Email change pending for <strong>{user.pendingEmail}</strong>. Your current email stays active until the new address is confirmed.
              </div>
            ) : null}

            {!user.emailVerified ? (
              <div className="mt-6 rounded-[24px] border border-amber-300/20 bg-amber-400/8 p-5">
                <p className="text-sm text-slate-200">
                  Verify your email before registering for tournaments. If you signed up with the wrong address, update it below first.
                </p>
                <div className="mt-4">
                  <ResendVerificationButton email={user.email} />
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              {user.role === "admin" ? (
                <Link href="/admin" className={buttonClassName({ variant: "secondary" })}>
                  Open Admin Dashboard
                </Link>
              ) : null}
              <Button
                variant="ghost"
                onClick={async () => {
                  await logout();
                  router.push("/");
                }}
              >
                Logout
              </Button>
            </div>
          </Card>

          <Card className="p-6 sm:p-8">
            <div className="mb-6 flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${activeTab === "account" ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/6 hover:text-white"}`}
                onClick={() => setActiveTab("account")}
              >
                Account
              </button>
              <button
                type="button"
                className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${activeTab === "teams" ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/6 hover:text-white"}`}
                onClick={() => setActiveTab("teams")}
              >
                Teams
              </button>
            </div>

            {activeTab === "account" ? (
              <div className="grid gap-8">
                <div>
                  <h3 className="text-2xl text-white">Edit Profile</h3>
                  <form className="mt-5 grid gap-5" onSubmit={submitProfile}>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <FormField label="First Name" htmlFor="firstName" error={profileForm.formState.errors.firstName?.message} required>
                        <Input id="firstName" {...profileForm.register("firstName")} />
                      </FormField>
                      <FormField label="Last Name" htmlFor="lastName" error={profileForm.formState.errors.lastName?.message} required>
                        <Input id="lastName" {...profileForm.register("lastName")} />
                      </FormField>
                    </div>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <FormField label="Username" htmlFor="username" error={profileForm.formState.errors.username?.message} required>
                        <Input id="username" {...profileForm.register("username")} />
                      </FormField>
                      <FormField label="Email" htmlFor="email">
                        <Input id="email" disabled {...profileForm.register("email")} />
                      </FormField>
                    </div>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <FormField label="Phone" htmlFor="phone">
                        <Input id="phone" {...profileForm.register("phone")} />
                      </FormField>
                      <FormField label="Discord Tag" htmlFor="discordTag">
                        <Input id="discordTag" {...profileForm.register("discordTag")} />
                      </FormField>
                    </div>
                    {profileForm.formState.errors.root?.message ? <p className="text-sm text-slate-300">{profileForm.formState.errors.root.message}</p> : null}
                    <Button type="submit" disabled={profileForm.formState.isSubmitting}>
                      {profileForm.formState.isSubmitting ? "Saving..." : "Save Changes"}
                    </Button>
                  </form>
                </div>

                <div className="border-t border-white/8 pt-8">
                  <h3 className="text-2xl text-white">Change Email</h3>
                  <p className="mt-2 text-sm text-slate-400">
                    We keep your current email active until the new address is confirmed.
                  </p>
                  <form className="mt-5 grid gap-5" onSubmit={submitEmailChange}>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <FormField label="New Email" htmlFor="newEmail" error={emailForm.formState.errors.newEmail?.message} required>
                        <Input id="newEmail" type="email" {...emailForm.register("newEmail")} />
                      </FormField>
                      <FormField label="Current Password" htmlFor="currentPassword" error={emailForm.formState.errors.currentPassword?.message} required>
                        <Input id="currentPassword" type="password" {...emailForm.register("currentPassword")} />
                      </FormField>
                    </div>
                    {emailForm.formState.errors.root?.message ? <p className="text-sm text-slate-300">{emailForm.formState.errors.root.message}</p> : null}
                    <Button type="submit" variant="secondary" disabled={emailForm.formState.isSubmitting}>
                      {emailForm.formState.isSubmitting ? "Sending..." : user.pendingEmail ? "Send New Confirmation" : "Change Email"}
                    </Button>
                  </form>
                </div>
              </div>
            ) : (
              <div>
                <h3 className="text-2xl text-white">Saved Teams</h3>
                <p className="mt-2 text-sm text-slate-400">
                  Teams created during tournament registration appear here for reuse in future events.
                </p>

                {teamsError ? <p className="mt-5 text-sm text-rose-300">{teamsError}</p> : null}
                {teamsLoading ? (
                  <div className="mt-6">
                    <LoadingState title="Loading teams" description="Fetching your saved roster data." />
                  </div>
                ) : teams.length === 0 ? (
                  <div className="mt-6 rounded-[24px] border border-white/8 bg-white/5 p-5">
                    <p className="text-sm text-slate-300">
                      No saved teams yet. Register a tournament team to save it here for future use.
                    </p>
                    <div className="mt-4">
                      <Link href="/tournament-registration" className={buttonClassName({})}>
                        Register a Team
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 grid gap-4">
                    {teams.map((team) => (
                      <div key={team.id} className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h4 className="text-xl font-semibold text-white">{team.name}</h4>
                            <p className="text-sm text-slate-400">
                              Updated {new Date(team.updatedAt).toLocaleDateString()}
                            </p>
                          </div>
                          <Link
                            href={`/tournament-registration?savedTeam=${team.id}`}
                            className={buttonClassName({ variant: "secondary" })}
                          >
                            Reuse Team
                          </Link>
                        </div>
                        <div className="mt-5 grid gap-3">
                          {team.members.map((member) => (
                            <div key={member.id} className="flex flex-col gap-3 rounded-[20px] border border-white/8 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="font-medium text-white">{member.name}</p>
                                <p className="text-sm text-slate-400">{formatMemberRole(member.role, member.memberOrder)}</p>
                                <p className="text-sm text-slate-500">{member.email}</p>
                              </div>
                              <Badge>{member.inviteStatus}</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </Container>
    </section>
  );
}
