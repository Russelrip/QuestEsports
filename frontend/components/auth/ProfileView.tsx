"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiFetch, apiFetchJson, getApiErrorMessage } from "@/lib/auth";
import { readApiResponse } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import ChangePasswordForm from "@/components/auth/ChangePasswordForm";
import ResendVerificationButton from "@/components/auth/ResendVerificationButton";
import SessionList from "@/components/auth/SessionList";
import AccountLinkingPanel from "@/components/auth/AccountLinkingPanel";
import GameAccountsPanel from "@/components/auth/GameAccountsPanel";
import TeamManagementPanel, { TeamSummaryGrid } from "@/components/auth/TeamManagementPanel";
import { InvitationsPanel } from "@/components/auth/InvitationsPanel";
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
import { resolveImageUrl } from "@/lib/media";
import { AccountDashboard, DashboardRegistration, fetchAccountDashboard } from "@/lib/account";
import { type VetoRoom, vetoRequest } from "@/lib/veto";
import { type MatchRoomSummary, roomRequest } from "@/lib/match-rooms";

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required."),
  lastName: z.string().min(1, "Last name is required."),
  username: z.string().min(1, "Username is required."),
  email: z.string(),
  phone: z.string().optional(),
});

const emailChangeSchema = z.object({
  newEmail: z.string().email("Please enter a valid email address."),
  currentPassword: z.string().min(1, "Current password is required."),
});

type ProfileFormValues = z.infer<typeof profileSchema>;
type EmailChangeValues = z.infer<typeof emailChangeSchema>;

function RegistrationCards({ entries, empty }: { entries: DashboardRegistration[]; empty: string }) {
  if (entries.length === 0) return <p className="border border-dashed border-white/10 bg-[#11131c] p-6 text-sm text-slate-400">{empty}</p>;

  return <div className="grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-3">{entries.map((entry) => {
    // A free tournament has no fee, so its registration carries no payment to
    // report. Badging it "paid" only raises a question about money nobody was
    // ever asked for.
    const isFreeEntry = entry.tournament.paymentMethod === "free";
    const awaitingRoster = entry.entryType === "team" && entry.verificationStatus !== "verified";
    const readyForPayment = entry.entryType === "team" && entry.verificationStatus === "verified" && entry.paymentStatus === "unpaid";
    const needsBankPayment = !awaitingRoster && entry.payment?.provider === "bank_transfer" && entry.payment.status !== "paid";
    const needsOnlinePayment = !awaitingRoster && entry.payment?.provider === "payhere" && entry.payment.status !== "paid";
    const href = awaitingRoster
      ? "/profile?tab=teams"
      : needsBankPayment
        ? `/tournaments/${entry.tournament.slug}/payment?order=${encodeURIComponent(entry.payment?.orderId || "")}`
        : needsOnlinePayment || readyForPayment
          ? `/tournaments/${entry.tournament.slug}/register`
          : `/tournaments/${entry.tournament.slug}`;
    const eventDate = entry.tournament.startDateStatus === "scheduled" && entry.tournament.startDate
      ? new Date(entry.tournament.startDate).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
      : entry.tournament.startDateStatus.toUpperCase();

    return <article key={entry.id} className="flex h-full min-w-0 flex-col overflow-hidden border border-white/10 bg-[#181a24] shadow-[0_18px_45px_rgba(0,0,0,0.2)]">
      <div className="relative aspect-[16/8] overflow-hidden bg-[#090b12]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_25%,rgba(168,85,247,0.28),transparent_36%),linear-gradient(135deg,#111827,#090b12)]" />
        {(() => { const bannerUrl = resolveImageUrl(entry.tournament.bannerUrl); return bannerUrl ? <Image src={bannerUrl} alt={`${entry.tournament.title} poster`} fill className="object-cover" sizes="(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 100vw" unoptimized onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null; })()}
        <span className="absolute left-4 top-4 bg-black/75 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-purple-200 backdrop-blur">{entry.tournament.game}</span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{entry.entryType === "solo" ? "Solo registration" : entry.displayName}</p>{entry.event ? <p className="mt-2 text-xs uppercase tracking-[0.14em] text-purple-200">{entry.event.title} &middot; /{entry.event.slug}</p> : null}
        <h4 className="mt-2 line-clamp-2 min-h-12 text-lg font-bold uppercase leading-6 text-white">{entry.tournament.title}</h4>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-white/8 py-4">
          <div><dt className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Event date</dt><dd className="mt-1.5 text-xs font-semibold text-white">{eventDate}</dd></div>
          <div><dt className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Registration</dt><dd className="mt-1.5 text-xs font-semibold capitalize text-white">{entry.status}</dd></div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2"><Badge>{entry.status}</Badge><Badge>{entry.verificationStatus}</Badge>{isFreeEntry ? null : <Badge>{entry.payment?.status || entry.paymentStatus}</Badge>}</div>
        <Link href={href} className="mt-5 flex items-center justify-between bg-purple-300 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-950 transition hover:bg-purple-200">
          <span>{awaitingRoster ? "Confirm full roster" : needsBankPayment ? "Complete bank transfer" : needsOnlinePayment ? "Retry online payment" : readyForPayment ? "Continue to payment" : "View tournament"}</span><span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>;
  })}</div>;
}

export default function ProfileView() {
  const router = useRouter();
  const { user, refreshUser, logout, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<"dashboard" | "account" | "security" | "teams" | "invitations">("dashboard");
  const [dashboard, setDashboard] = useState<AccountDashboard | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [vetoRooms, setVetoRooms] = useState<VetoRoom[]>([]);
  const [matchRooms, setMatchRooms] = useState<MatchRoomSummary[]>([]);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [showCreatedTeamNotice, setShowCreatedTeamNotice] = useState(false);
  const { data: teamsData, setData: setTeamsData, loading: teamsLoading, error: teamsError } = useTeams(Boolean(user));
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
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "account") {
      setActiveTab("account");
    } else if (params.get("tab") === "invitations") {
      // Every invitation notice points here, and so does the onboarding page a
      // captain's copied link starts at.
      setActiveTab("invitations");
    } else if (params.get("tab") === "teams") {
      setActiveTab("teams");
      setSelectedTeamId(params.get("team"));
      setShowCreatedTeamNotice(params.get("created") === "1");
    }
  }, []);

  useEffect(() => {
    if (!isLoading && !user) {
      // Carrying the whole destination, not just the fact that a login is
      // needed. Someone arriving from an invitation link has already been sent
      // somewhere specific; dropping them on the dashboard afterwards makes
      // them go and find it again, and the link they were sent is by then two
      // redirects behind them.
      const destination = `${window.location.pathname}${window.location.search}`;
      router.replace(
        destination === "/profile"
          ? "/login"
          : `/login?redirect=${encodeURIComponent(destination)}`
      );
      return;
    }

    if (user) {
      profileForm.reset({
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        username: user.username || "",
        email: user.email || "",
        phone: user.phone || "",
      });
    }
  }, [isLoading, profileForm, router, user]);

  useEffect(() => {
    if (!user) return;
    setDashboardLoading(true);
    fetchAccountDashboard().then(setDashboard).catch((error) => setDashboardError(error instanceof Error ? error.message : "Could not load dashboard.")).finally(() => setDashboardLoading(false));
    vetoRequest<VetoRoom[]>("/api/v1/veto-rooms/mine").then(setVetoRooms).catch(() => setVetoRooms([]));
    roomRequest<MatchRoomSummary[]>("/api/v1/match-rooms/mine").then(setMatchRooms).catch(() => setMatchRooms([]));
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
  const avatarUrl = resolveImageUrl(user.avatarUrl);

  const handleTeamUpdated = (updatedTeam: (typeof teams)[number]) => {
    setTeamsData((current) => (current || []).map((team) => team.id === updatedTeam.id ? updatedTeam : team));
    setDashboard((current) => current ? { ...current, teams: current.teams.map((team) => team.id === updatedTeam.id ? updatedTeam : team) } : current);
  };

  const handleTeamDeleted = (teamId: string) => {
    setTeamsData((current) => (current || []).filter((team) => team.id !== teamId));
    setDashboard((current) => current ? { ...current, teams: current.teams.filter((team) => team.id !== teamId) } : current);
  };

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
        },
      });

      const data = await readApiResponse<{
        success?: boolean;
        message?: string;
        user?: typeof user;
      }>(response, "Failed to update profile.");
      if (!response.ok || !data.success) {
        profileForm.setError("root", { message: data.message || "Failed to update profile." });
        return;
      }

      if (!data.user) {
        profileForm.setError("root", { message: "The updated profile was not returned. Please refresh and try again." });
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
        <div className="grid min-w-0 gap-6">
          <Card className="relative overflow-hidden p-6 sm:p-8">
            <div className="relative flex min-w-0 flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-5">
                <div className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-violet-700 text-lg font-bold text-white shadow-[0_14px_40px_rgba(0,0,0,0.35)]">
                  {initials}{avatarUrl ? <Image src={avatarUrl} alt={`${user.firstName} ${user.lastName}`} fill className="object-cover" sizes="80px" unoptimized onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
                </div>
                <div className="profile-identity-text min-w-0 max-w-full">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-purple-200/75">Player overview</p>
                  <h2 className="mt-2 break-words text-2xl leading-tight text-white [overflow-wrap:anywhere] sm:text-3xl">{user.firstName} {user.lastName}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-400"><span>@{user.username}</span><span aria-hidden="true">•</span><span>{user.email}</span><Badge className={user.emailVerified ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-200" : "border-amber-300/20 bg-amber-400/10 text-amber-200"}>{user.emailVerified ? "Verified" : "Verification needed"}</Badge></div>
                </div>
              </div>
              <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
                <label className={buttonClassName({ variant: "secondary", className: "w-full min-w-0 cursor-pointer px-2 sm:w-auto sm:px-5" })}>{avatarSaving ? "Saving..." : "Change photo"}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={avatarSaving} onChange={(event) => void updateAvatar(event.target.files?.[0])} /></label>
                {user.avatarUrl ? <Button className="min-w-0 px-2 sm:px-5" type="button" variant="ghost" disabled={avatarSaving} onClick={() => void removeAvatar()}>Remove photo</Button> : null}
                {user.role === "admin" ? <Link href="/admin" className={buttonClassName({ variant: "secondary", className: "min-w-0 px-2 sm:px-5" })}>Admin</Link> : null}
                <Button className="min-w-0 px-2 sm:px-5" variant="ghost" onClick={async () => { if (await logout()) router.push("/"); }}>Logout</Button>
              </div>
            </div>

            {user.pendingEmail ? (
              <div className="relative mt-6 border border-amber-300/20 bg-amber-400/8 p-4 text-sm text-slate-200">
                Email change pending for <strong className="break-words [overflow-wrap:anywhere]">{user.pendingEmail}</strong>. Your current email stays active until the new address is confirmed.
              </div>
            ) : null}

            {!user.emailVerified ? (
              <div className="relative mt-4 flex flex-col gap-4 border border-amber-300/20 bg-amber-400/8 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-200">
                  Verify your email before registering for tournaments. If you signed up with the wrong address, update it below first.
                </p>
                <div className="shrink-0">
                  <ResendVerificationButton email={user.email} />
                </div>
              </div>
            ) : null}
          </Card>

          <Card className="min-w-0 overflow-hidden p-4 sm:p-6 lg:p-8">
            <div className="mb-8 grid grid-cols-2 gap-1 border-b border-white/8 sm:flex" role="tablist" aria-label="Profile sections">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "dashboard"}
                className={`min-w-0 border-b-2 px-2 py-3 text-sm font-medium transition sm:px-4 ${activeTab === "dashboard" ? "border-purple-300 text-white" : "border-transparent text-slate-400 hover:text-white"}`}
                onClick={() => setActiveTab("dashboard")}
              >
                Overview
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "account"}
                className={`min-w-0 border-b-2 px-2 py-3 text-sm font-medium transition sm:px-4 ${activeTab === "account" ? "border-purple-300 text-white" : "border-transparent text-slate-400 hover:text-white"}`}
                onClick={() => setActiveTab("account")}
              >
                Account
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "teams"}
                className={`min-w-0 border-b-2 px-2 py-3 text-sm font-medium transition sm:px-4 ${activeTab === "teams" ? "border-purple-300 text-white" : "border-transparent text-slate-400 hover:text-white"}`}
                onClick={() => setActiveTab("teams")}
              >
                Teams
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "invitations"}
                className={`min-w-0 border-b-2 px-2 py-3 text-sm font-medium transition sm:px-4 ${activeTab === "invitations" ? "border-purple-300 text-white" : "border-transparent text-slate-400 hover:text-white"}`}
                onClick={() => setActiveTab("invitations")}
              >
                Invitations
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "security"}
                className={`min-w-0 border-b-2 px-2 py-3 text-sm font-medium transition sm:px-4 ${activeTab === "security" ? "border-purple-300 text-white" : "border-transparent text-slate-400 hover:text-white"}`}
                onClick={() => setActiveTab("security")}
              >
                Security
              </button>
            </div>

            {activeTab === "dashboard" ? (
              <div className="grid min-w-0 gap-10">
                {dashboardLoading ? <LoadingState title="Loading dashboard" description="Fetching your registrations and orders." /> : dashboardError ? <p className="text-sm text-rose-300">{dashboardError}</p> : dashboard ? <>
                  <div className="grid gap-3 sm:grid-cols-3">{[["Active registrations", dashboard.currentRegistrations.length], ["Completed tournaments", dashboard.pastRegistrations.length], ["Teams you are in", dashboard.teams.length]].map(([label, value], index) => <div key={String(label)} className="relative overflow-hidden border border-white/8 bg-[#171923] p-5"><span className={`absolute inset-y-0 left-0 w-1 ${index === 0 ? "bg-purple-300" : index === 1 ? "bg-violet-400" : "bg-emerald-300"}`} /><p className="text-3xl font-semibold text-white">{value}</p><p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p></div>)}</div>

                  {matchRooms.length ? <section>
                    <div className="mb-5"><p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/70">Competition rooms</p><h3 className="mt-2 border-l-2 border-cyan-300 pl-3 text-2xl text-white">Your Matches</h3></div>
                    <div className="grid gap-3 md:grid-cols-2">{matchRooms.map((room) => <Link key={room.id} href={`/match-room/${room.code}`} className="border border-cyan-300/15 bg-cyan-400/[.055] p-5 transition hover:border-cyan-200/40"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-white">{room.match.participants.map((entry) => entry.displayName).join(" vs ")}</p><p className="mt-1 text-xs uppercase tracking-[.14em] text-slate-400">{room.match.tournament.title} · {room.match.status.replaceAll("_", " ")}</p></div><div className="flex gap-2"><Badge>{room.role}</Badge>{room.unreadMessages ? <Badge>{room.unreadMessages} new</Badge> : null}</div></div><p className="mt-4 text-sm font-semibold text-cyan-200">Open match room →</p></Link>)}</div>
                  </section> : null}

                  {vetoRooms.length && !matchRooms.length ? <section>
                    <div className="mb-5"><p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/70">Pre-match rooms</p><h3 className="mt-2 border-l-2 border-cyan-300 pl-3 text-2xl text-white">Your Map Vetos</h3></div>
                    <div className="grid gap-3 md:grid-cols-2">{vetoRooms.map((room) => <Link key={room.id} href={`/veto/${room.code}`} className="border border-cyan-300/15 bg-cyan-400/[.055] p-5 transition hover:border-cyan-200/40"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-white">{room.title}</p><p className="mt-1 text-xs uppercase tracking-[.14em] text-slate-400">{room.format} · {room.status.replaceAll("_", " ")}</p></div><Badge>{room.access.slot ? `Slot ${room.access.slot}` : "Captain"}</Badge></div><p className="mt-4 text-sm font-semibold text-cyan-200">Join veto room →</p></Link>)}</div>
                  </section> : null}

                  <section>
                    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.22em] text-purple-200/70">Your squads</p><h3 className="mt-2 border-l-2 border-purple-300 pl-3 text-2xl text-white">Teams You Are In</h3></div><button type="button" className="text-sm font-semibold text-purple-200 hover:text-white" onClick={() => setActiveTab("teams")}>Manage teams →</button></div>
                    {dashboard.teams.length ? <TeamSummaryGrid teams={dashboard.teams} onSelect={(teamId) => { setSelectedTeamId(teamId); setActiveTab("teams"); }} /> : <div className="flex flex-wrap items-center justify-between gap-4 border border-dashed border-white/10 bg-[#11131c] p-6"><p className="text-sm text-slate-400">You are not part of a saved team yet.</p><Link href="/registration" className={buttonClassName({})}>Create team</Link></div>}
                  </section>

                  <section className="border-t border-white/8 pt-10">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-purple-200/70">Competition record</p>
                    <h3 className="mt-2 border-l-2 border-purple-300 pl-3 text-2xl text-white">Tournament History</h3>
                    <div className="mt-8"><div className="mb-4 flex items-center justify-between gap-3"><h4 className="text-lg font-semibold text-white">Active Registrations</h4><span className="text-xs text-slate-500">{dashboard.currentRegistrations.length} active</span></div><RegistrationCards entries={dashboard.currentRegistrations} empty="You do not have an active tournament registration." /></div>
                    <div className="mt-10"><div className="mb-4 flex items-center justify-between gap-3"><h4 className="text-lg font-semibold text-white">Completed Tournaments</h4><span className="text-xs text-slate-500">{dashboard.pastRegistrations.length} completed</span></div><RegistrationCards entries={dashboard.pastRegistrations} empty="Your completed tournament history will appear here." /></div>
                  </section>

                  <section className="border-t border-white/8 pt-10">
                    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="border-l-2 border-purple-300 pl-3 text-2xl text-white">Recruitment Applications</h3><Link href="/join" className="text-sm text-purple-200">Submit application</Link></div>
                    {dashboard.recruitmentApplications.length ? (
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {dashboard.recruitmentApplications.map((application) => (
                          <div key={application.id} className="border border-white/8 bg-[#171923] p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold capitalize text-white">{application.teamName || application.applicationType.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-400">{application.game} · submitted {new Date(application.createdAt).toLocaleDateString()}</p></div><Badge>{application.status}</Badge></div>
                            <p className="mt-3 text-xs leading-5 text-slate-400">{application.status === "pending" ? "Your application is waiting for management review." : `Application status: ${application.status}.`}</p>
                          </div>
                        ))}
                      </div>
                    ) : <p className="mt-5 text-sm text-slate-400">No recruitment applications submitted yet.</p>}
                  </section>

                  <section className="border-t border-white/8 pt-10">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="border-l-2 border-purple-300 pl-3 text-2xl text-white">Merchandise Orders</h3>
                      <Link href="/shop" className="text-sm text-purple-200">Visit shop</Link>
                    </div>
                    {dashboard.orders.length ? (
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {dashboard.orders.map((order) => (
                          <Link
                            key={order.id}
                            href={`/shop/order#token=${encodeURIComponent(order.publicToken)}`}
                            className="flex flex-wrap items-center justify-between gap-3 border border-white/8 bg-[#171923] p-4 text-sm transition hover:border-purple-300/25"
                          >
                            <span className="text-white">
                              {order.itemCount} item{order.itemCount === 1 ? "" : "s"} &middot; {order.currency} {order.total.toFixed(2)}
                            </span>
                            <span className="capitalize text-slate-400">{order.status} &middot; {order.paymentStatus}</span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-5 text-sm text-slate-400">No merchandise orders yet.</p>
                    )}
                  </section>
                </> : null}
              </div>
            ) : activeTab === "invitations" ? (
              <div className="grid min-w-0 gap-8">
                <InvitationsPanel />
              </div>
            ) : activeTab === "account" ? (
              <div className="grid min-w-0 gap-8">
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
                      <div className="rounded-xl border border-white/8 bg-white/[.02] p-4 sm:col-span-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/70">Connected Discord</p>
                        {user.discordId ? (
                          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div><dt className="text-xs text-slate-500">Username</dt><dd className="mt-1 text-sm font-medium text-white">{user.discordTag || "Not available"}</dd></div>
                            <div><dt className="text-xs text-slate-500">Discord ID</dt><dd className="mt-1 break-all font-mono text-sm text-slate-200">{user.discordId || "Not available"}</dd></div>
                          </dl>
                        ) : <p className="mt-2 text-sm leading-6 text-slate-500">Connect Discord under Linked accounts to display your private connected-account details.</p>}
                        <p className="mt-3 text-xs leading-5 text-slate-500">These details come from Discord and cannot be edited here.</p>
                      </div>
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
                <AccountLinkingPanel />
                <GameAccountsPanel />
              </div>
            ) : activeTab === "security" ? (
              <div className="grid min-w-0 gap-6">
                <ChangePasswordForm />
                <SessionList />
              </div>
            ) : (
              <div className="min-w-0">
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

                {showCreatedTeamNotice ? (
                  <div className="mt-6 border border-emerald-300/20 bg-emerald-400/8 p-4 text-sm leading-6 text-slate-200">
                    <p className="font-semibold text-emerald-200">Team created successfully.</p>
                    <p className="mt-1">Invited roster members are marked as pending below until they accept their email invitation. You can resend an invitation after its countdown ends.</p>
                  </div>
                ) : null}

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
                  <div className="mt-6">
                    <TeamManagementPanel
                      teams={teams}
                      selectedTeamId={selectedTeamId}
                      onSelect={setSelectedTeamId}
                      onTeamUpdated={handleTeamUpdated}
                      onTeamDeleted={handleTeamDeleted}
                    />
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
