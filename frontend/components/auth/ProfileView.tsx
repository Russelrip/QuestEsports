"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiFetch, apiFetchJson, getApiErrorMessage } from "@/lib/auth";
import { useAuth } from "@/components/auth/AuthProvider";
import ChangePasswordForm from "@/components/auth/ChangePasswordForm";
import MfaSettingsPanel from "@/components/auth/MfaSettingsPanel";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import SessionList from "@/components/auth/SessionList";
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
import { buildApiUrl } from "@/lib/api";
import { AccountDashboard, DashboardRegistration, fetchAccountDashboard } from "@/lib/account";

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

function RegistrationCards({ entries, empty }: { entries: DashboardRegistration[]; empty: string }) {
  if (entries.length === 0) return <p className="rounded-[22px] border border-white/8 bg-white/5 p-5 text-sm text-slate-400">{empty}</p>;
  return <div className="grid gap-4 sm:grid-cols-2">{entries.map((entry) => (
    <Link key={entry.id} href={`/tournaments/${entry.tournament.slug}`} className="group overflow-hidden rounded-[24px] border border-white/8 bg-white/5 transition hover:-translate-y-0.5 hover:border-cyan-300/25">
      {entry.tournament.bannerUrl ? <div className="relative aspect-[16/7]"><Image src={buildApiUrl(entry.tournament.bannerUrl)} alt="" fill className="object-cover" sizes="(min-width: 640px) 40vw, 100vw" /></div> : null}
      <div className="p-5"><p className="text-xs uppercase tracking-[0.2em] text-cyan-200/70">{entry.tournament.game}</p><h4 className="mt-2 text-lg text-white">{entry.tournament.title}</h4><p className="mt-2 text-sm text-slate-400">{entry.displayName}</p><div className="mt-4 flex flex-wrap gap-2"><Badge>{entry.status}</Badge><Badge>{entry.paymentStatus}</Badge></div></div>
    </Link>
  ))}</div>;
}

export default function ProfileView() {
  const router = useRouter();
  const { user, refreshUser, logout, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<"dashboard" | "account" | "security" | "teams">("dashboard");
  const [dashboard, setDashboard] = useState<AccountDashboard | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
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

  useEffect(() => {
    if (!user) return;
    setDashboardLoading(true);
    fetchAccountDashboard().then(setDashboard).catch((error) => setDashboardError(error instanceof Error ? error.message : "Could not load dashboard.")).finally(() => setDashboardLoading(false));
  }, [user]);

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

  const updateAvatar = async (file?: File) => {
    if (!file) return;
    const body = new FormData();
    body.append("avatar", file);
    setAvatarSaving(true);
    try {
      const { response, data } = await apiFetchJson<{ success?: boolean; message?: string; user?: typeof user }>("/api/me/avatar", { method: "POST", body });
      const message = getApiErrorMessage(response, data, "Could not update profile picture.");
      if (message || !data.user) throw new Error(message || "Could not update profile picture.");
      refreshUser(data.user);
      showToast({ tone: "success", title: "Profile picture updated" });
    } catch (error) { showToast({ tone: "error", title: error instanceof Error ? error.message : "Avatar upload failed" }); }
    finally { setAvatarSaving(false); }
  };

  const removeAvatar = async () => {
    setAvatarSaving(true);
    try {
      const { response, data } = await apiFetchJson<{ success?: boolean; message?: string; user?: typeof user }>("/api/me/avatar", { method: "DELETE" });
      const message = getApiErrorMessage(response, data, "Could not remove profile picture.");
      if (message || !data.user) throw new Error(message || "Could not remove profile picture.");
      refreshUser(data.user);
    } catch (error) { showToast({ tone: "error", title: error instanceof Error ? error.message : "Avatar removal failed" }); }
    finally { setAvatarSaving(false); }
  };

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
              <div className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-[24px] bg-violet-700 text-lg font-bold text-white">
                {user.avatarUrl ? <Image src={buildApiUrl(user.avatarUrl)} alt={`${user.firstName} ${user.lastName}`} fill className="object-cover" sizes="80px" /> : initials}
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

            <div className="mt-5 flex flex-wrap gap-2">
              <label className={buttonClassName({ variant: "secondary", className: "cursor-pointer" })}>{avatarSaving ? "Saving..." : "Upload photo"}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={avatarSaving} onChange={(event) => void updateAvatar(event.target.files?.[0])} /></label>
              {user.avatarUrl ? <Button type="button" variant="ghost" disabled={avatarSaving} onClick={() => void removeAvatar()}>Remove</Button> : null}
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
                className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${activeTab === "dashboard" ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/6 hover:text-white"}`}
                onClick={() => setActiveTab("dashboard")}
              >
                Dashboard
              </button>
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
              <button
                type="button"
                className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${activeTab === "security" ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/6 hover:text-white"}`}
                onClick={() => setActiveTab("security")}
              >
                Security
              </button>
            </div>

            {activeTab === "dashboard" ? (
              <div className="grid gap-8">
                {dashboardLoading ? <LoadingState title="Loading dashboard" description="Fetching your registrations and orders." /> : dashboardError ? <p className="text-sm text-rose-300">{dashboardError}</p> : dashboard ? <>
                  <div><h3 className="text-2xl text-white">Current registrations</h3><div className="mt-5"><RegistrationCards entries={dashboard.currentRegistrations} empty="You do not have an active tournament registration." /></div></div>
                  <div className="border-t border-white/8 pt-8"><h3 className="text-2xl text-white">Past events</h3><div className="mt-5"><RegistrationCards entries={dashboard.pastRegistrations} empty="Your completed tournament history will appear here." /></div></div>
                  <div className="border-t border-white/8 pt-8"><div className="flex items-center justify-between gap-3"><h3 className="text-2xl text-white">Merchandise orders</h3><Link href="/shop" className="text-sm text-cyan-200">Visit shop</Link></div>{dashboard.orders.length ? <div className="mt-5 grid gap-3">{dashboard.orders.map((order) => <Link key={order.id} href={`/shop/order/${order.publicToken}`} className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-white/8 bg-white/5 p-4 text-sm"><span className="text-white">{order.itemCount} item{order.itemCount === 1 ? "" : "s"} · {order.currency} {order.total.toFixed(2)}</span><span className="text-slate-400">{order.status} · {order.paymentStatus}</span></Link>)}</div> : <p className="mt-5 text-sm text-slate-400">No merchandise orders yet.</p>}</div>
                </> : null}
              </div>
            ) : activeTab === "account" ? (
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
            ) : activeTab === "security" ? (
              <div className="grid gap-6">
                <ChangePasswordForm />
                <MfaSettingsPanel />
                <SessionList />
              </div>
            ) : (
              <div>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-2xl text-white">My Teams</h3>
                    <p className="mt-2 text-sm text-slate-400">
                      Teams you captain or have accepted an invitation to join appear here.
                    </p>
                  </div>
                  <Link href="/registration" className={buttonClassName({})}>
                    Create Team
                  </Link>
                </div>

                {teamsError ? <p className="mt-5 text-sm text-rose-300">{teamsError}</p> : null}
                {teamsLoading ? (
                  <div className="mt-6">
                    <LoadingState title="Loading teams" description="Fetching your saved roster data." />
                  </div>
                ) : teams.length === 0 ? (
                  <div className="mt-6 rounded-[24px] border border-white/8 bg-white/5 p-5">
                    <p className="text-sm text-slate-300">
                      No saved teams yet. Create one here, then reuse it for future tournament registrations.
                    </p>
                    <div className="mt-4">
                      <Link href="/registration" className={buttonClassName({})}>
                        Create a Team
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 grid gap-4">
                    {teams.map((team) => (
                      <div key={team.id} className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-4">
                            <div className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-black/30 text-sm font-bold text-white">{team.logoUrl ? <Image src={buildApiUrl(team.logoUrl)} alt={`${team.name} logo`} fill className="object-contain p-1" sizes="64px" /> : getInitials(team.name)}</div>
                            <div>
                            <h4 className="text-xl font-semibold text-white">{team.name}</h4>
                            {team.teamTag || team.country ? (
                              <p className="text-sm text-cyan-200">
                                {[team.teamTag, team.country].filter(Boolean).join(" · ")}
                              </p>
                            ) : null}
                            <p className="text-sm text-slate-400">
                              Captain: {team.captainName} · {team.isCaptain ? "You are the captain" : "You are a member"}
                            </p>
                            <p className="text-sm text-slate-400">
                              Updated {new Date(team.updatedAt).toLocaleDateString()}
                            </p>
                            {team.organizationRequested ? (
                              <p className="text-sm text-amber-200">
                                Quest E-sports membership requested
                              </p>
                            ) : null}
                            </div>
                          </div>
                          {team.isCaptain ? (
                            <Link
                              href="/tournaments"
                              className={buttonClassName({ variant: "secondary" })}
                            >
                              Find a Tournament
                            </Link>
                          ) : (
                            <Badge>Member</Badge>
                          )}
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
