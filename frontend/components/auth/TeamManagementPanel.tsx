"use client";

import Image from "next/image";
import { FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToastStore } from "@/hooks/useToastStore";
import { resolveImageUrl } from "@/lib/media";
import { teamCountries } from "@/lib/countries";
import {
  deleteSavedTeam,
  type ManageTeamMemberInput,
  nudgeTeamInvite,
  type SavedTeam,
  type TeamInviteStatus,
  updateSavedTeam,
} from "@/lib/teams";
import { getInitials } from "@/lib/utils";

type EditableMember = ManageTeamMemberInput & {
  key: string;
  inviteStatus?: TeamInviteStatus;
  originalEmail?: string;
  inviteSentAt?: string | null;
  inviteRespondedAt?: string | null;
  // Why this member has not accepted yet, when the answer is not "they have not
  // got round to it". A captain chasing a roster needs to know which of the two
  // problems they actually have.
  hasQuestAccount?: boolean;
  hasDiscord?: boolean;
};

const INVITE_STATUS_LABELS: Record<TeamInviteStatus, string> = {
  pending: "Waiting",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

// What is standing between this person and accepting. Ordered by what the
// captain would have to do about it first.
const describeBlocker = (member: EditableMember) => {
  if (member.inviteStatus !== "pending") return null;
  if (member.hasQuestAccount === false) {
    return "No Quest account yet — send them the invitation link.";
  }
  if (member.hasDiscord === false) {
    return "Signed up, but has not connected Discord. They cannot accept until they do.";
  }
  return null;
};

const INVITE_RESEND_COOLDOWN_MS = 60 * 1000;

const emptyMember = (): EditableMember => ({
  key: `${Date.now()}-${Math.random()}`,
  role: "PLAYER",
  name: "",
  email: "",
  phone: "",
  discord: "",
  riotId: "",
});

export function TeamSummaryGrid({
  teams,
  onSelect,
}: {
  teams: SavedTeam[];
  onSelect: (teamId: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {teams.map((team) => {
        const logoUrl = resolveImageUrl(team.logoUrl);
        const pendingInviteCount = team.members.filter(
          (member) => member.inviteStatus === "pending"
        ).length;
        return (
          <button
            key={team.id}
            type="button"
            onClick={() => onSelect(team.id)}
            className="group overflow-hidden border border-white/10 bg-[#12141d] text-left transition hover:-translate-y-1 hover:border-white/25 hover:shadow-[0_22px_55px_rgba(0,0,0,0.38)] motion-reduce:hover:translate-y-0"
          >
            <span className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_40%,rgba(192,132,252,0.16),transparent_34%),linear-gradient(135deg,#171126,#0a0d16)]">
              <span aria-hidden="true" className="text-2xl font-bold text-white">{getInitials(team.name)}</span>
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt={`${team.name} logo`}
                  fill
                  className="absolute object-cover"
                  sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw"
                  unoptimized
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
              ) : (
                <>
                  <span className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:28px_28px]" />
                  <span className="relative flex size-24 items-center justify-center overflow-hidden border border-white/10 bg-black/30 text-2xl font-bold text-white shadow-[0_18px_45px_rgba(0,0,0,0.35)]">
                    {getInitials(team.name)}
                  </span>
                </>
              )}
            </span>
            <span className="block border-t border-white/10 bg-[#20232f] px-4 py-3">
              <span className="block truncate text-center text-sm font-bold uppercase text-purple-200">{team.name}</span>
              {pendingInviteCount > 0 ? <span className="mt-2 block text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200">{pendingInviteCount} pending invite{pendingInviteCount === 1 ? "" : "s"}</span> : null}
              <span className="mt-2 block truncate text-center text-[10px] uppercase tracking-[0.12em] text-slate-400">Organization · {team.organizationName || "Independent"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function TeamManagementPanel({
  teams,
  selectedTeamId,
  onSelect,
  onTeamUpdated,
  onTeamDeleted,
}: {
  teams: SavedTeam[];
  selectedTeamId: string | null;
  onSelect: (teamId: string | null) => void;
  onTeamUpdated: (team: SavedTeam) => void;
  onTeamDeleted: (teamId: string) => void;
}) {
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) || null;
  const showToast = useToastStore((state) => state.showToast);
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [teamTag, setTeamTag] = useState("");
  const [teamLogo, setTeamLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [members, setMembers] = useState<EditableMember[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [nudgingMemberId, setNudgingMemberId] = useState<string | null>(null);
  const [copiedMemberKey, setCopiedMemberKey] = useState<string | null>(null);
  const [inviteClock, setInviteClock] = useState(() => Date.now());
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedTeam) return;
    setName(selectedTeam.name);
    setCountry(selectedTeam.country || "");
    setTeamTag(selectedTeam.teamTag || "");
    setTeamLogo(null);
    setRemoveLogo(false);
    setError("");
    setMembers(
      selectedTeam.members
        .filter((member) => member.role !== "CAPTAIN")
        .map((member) => ({
          key: member.id,
          role: member.role === "SUBSTITUTE" || member.role === "COACH" ? member.role : "PLAYER",
          name: member.name,
          email: member.email,
          phone: member.phone || "",
          discord: member.discord || "",
          riotId: member.riotId || "",
          inviteStatus: member.inviteStatus,
          originalEmail: member.email,
          inviteSentAt: member.inviteSentAt,
          inviteRespondedAt: member.inviteRespondedAt,
          hasQuestAccount: member.hasQuestAccount,
          hasDiscord: member.hasDiscord,
        }))
    );
  }, [selectedTeam]);

  const hasPendingInvites = members.some((member) => member.inviteStatus === "pending");
  useEffect(() => {
    if (!hasPendingInvites) return;
    const timer = window.setInterval(() => setInviteClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasPendingInvites]);

  const updateMember = (key: string, updates: Partial<EditableMember>) => {
    setMembers((current) => current.map((member) => member.key === key ? { ...member, ...updates } : member));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTeam?.isCaptain) return;
    setSaving(true);
    setError("");
    try {
      const result = await updateSavedTeam({
        teamId: selectedTeam.id,
        name,
        country,
        teamTag,
        organizationRequested: false,
        teamLogo,
        removeLogo,
        members: members.map((member) => ({
          role: member.role,
          name: member.name,
          email: member.email,
          phone: member.phone,
          discord: member.discord,
          riotId: member.riotId,
        })),
      });
      onTeamUpdated(result.team);
      showToast({ tone: "success", title: "Team updated", description: result.message });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Could not update this team.";
      setError(message);
      showToast({ tone: "error", title: "Team update failed", description: message });
    } finally {
      setSaving(false);
    }
  };

  const removeTeam = async () => {
    if (!selectedTeam?.isCaptain || !selectedTeam.canDelete || !window.confirm(`Delete "${selectedTeam.name}" and its saved roster?`)) return;
    setDeleting(true);
    setError("");
    try {
      const message = await deleteSavedTeam(selectedTeam.id);
      onTeamDeleted(selectedTeam.id);
      onSelect(null);
      showToast({ tone: "success", title: "Team deleted", description: message });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Could not delete this team.";
      setError(message);
      showToast({ tone: "error", title: "Team deletion failed", description: message });
    } finally {
      setDeleting(false);
    }
  };

  // A reminder, not a delivery. The invitation is already sitting in their Quest
  // account; this reopens the window and says so again over the channels that
  // cost nothing, then reports which of them actually reached anybody.
  const nudgeInvite = async (member: EditableMember) => {
    if (!selectedTeam?.isCaptain || !member.inviteStatus || member.inviteStatus === "accepted") return;
    setNudgingMemberId(member.key);
    setError("");
    try {
      const result = await nudgeTeamInvite(selectedTeam.id, member.key);
      setMembers((current) => current.map((candidate) => candidate.key === member.key
        ? {
            ...candidate,
            inviteStatus: result.member.inviteStatus,
            inviteSentAt: result.member.inviteSentAt,
            inviteRespondedAt: result.member.inviteRespondedAt,
          }
        : candidate));
      setInviteClock(Date.now());
      showToast({
        // Never "invitation sent": the captain is the fallback channel, and
        // they can only be that if they are told the truth about what landed.
        tone: result.delivery?.hasQuestAccount ? "success" : "error",
        title: result.delivery?.hasQuestAccount ? "Reminder sent" : "Could not reach them",
        description: result.message,
      });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Could not send this reminder.";
      setError(message);
      showToast({ tone: "error", title: "Reminder not sent", description: message });
    } finally {
      setNudgingMemberId(null);
    }
  };

  // The channel that always works: the captain already talks to these people.
  const copyInvitationLink = async (member: EditableMember) => {
    const url = `${window.location.origin}/profile?tab=invitations`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedMemberKey(member.key);
      window.setTimeout(() => setCopiedMemberKey(null), 2000);
    } catch {
      showToast({
        tone: "error",
        title: "Could not copy the link",
        description: url,
      });
    }
  };

  if (!selectedTeam) {
    return <TeamSummaryGrid teams={teams} onSelect={(teamId) => onSelect(teamId)} />;
  }

  const captain = selectedTeam.members.find((member) => member.role === "CAPTAIN");
  return (
    <div className="grid min-w-0 gap-6">
      <button type="button" className="w-fit text-sm font-semibold text-purple-200 hover:text-white" onClick={() => onSelect(null)}>← Back to teams</button>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div className="min-w-0"><p className="text-xs uppercase tracking-[0.2em] text-purple-200/70">Team Management</p><h3 className="mt-2 break-words text-2xl text-white [overflow-wrap:anywhere] sm:text-3xl">{selectedTeam.name}</h3></div>
        <Badge>{selectedTeam.isCaptain ? "Captain controls" : "Member view"}</Badge>
      </div>

      {!selectedTeam.isCaptain ? (
        <div className="grid gap-3">
          {selectedTeam.members.map((member) => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 border border-white/8 bg-white/[0.03] p-4"><div><p className="font-semibold text-white">{member.name}</p><p className="mt-1 text-sm text-slate-400">{member.role} · {member.email}</p></div><Badge>{member.inviteStatus}</Badge></div>)}
        </div>
      ) : (
        <form className="grid gap-6" onSubmit={submit}>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Team name" htmlFor="manageTeamName" required><Input id="manageTeamName" required value={name} onChange={(event) => setName(event.target.value)} /></FormField>
            <FormField label="Team tag" htmlFor="manageTeamTag" required><Input id="manageTeamTag" required maxLength={12} value={teamTag} onChange={(event) => setTeamTag(event.target.value)} /></FormField>
            <FormField label="Country" htmlFor="manageTeamCountry" required><Select id="manageTeamCountry" required value={country} onChange={(event) => setCountry(event.target.value)}><option value="">Select country</option>{teamCountries.map((option) => <option key={option} value={option}>{option}</option>)}</Select></FormField>
          </div>

          <div className="grid gap-3 border border-white/8 bg-white/[0.025] p-4">
            <FormField label="Replace team logo" htmlFor="manageTeamLogo" hint="PNG, JPG, or WebP up to 5 MB"><Input id="manageTeamLogo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setTeamLogo(event.target.files?.[0] || null); setRemoveLogo(false); }} /></FormField>
            {selectedTeam.logoUrl ? <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={removeLogo} onChange={(event) => { setRemoveLogo(event.target.checked); if (event.target.checked) setTeamLogo(null); }} />Remove current logo</label> : null}
          </div>

          <section className="grid gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h4 className="text-xl text-white">Roster</h4><p className="mt-1 text-sm text-slate-400">Changing an email creates a new invitation. Accepted members with unchanged emails remain linked. Everyone must connect Discord before they can accept.</p></div><Button type="button" variant="secondary" onClick={() => setMembers((current) => [...current, emptyMember()])} disabled={members.length >= 20}>Add player</Button></div>
            <div className="grid gap-3 border border-purple-300/15 bg-purple-400/[0.03] p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold text-white">{captain?.name || selectedTeam.captainName}</p><p className="text-sm text-slate-400">{captain?.email || "Captain account"}</p></div><Badge>Captain</Badge></div></div>
            {members.map((member, index) => {
              const resendAvailableAt = member.inviteSentAt
                ? new Date(member.inviteSentAt).getTime() + INVITE_RESEND_COOLDOWN_MS
                : 0;
              const resendWaitSeconds = Math.max(
                Math.ceil((resendAvailableAt - inviteClock) / 1000),
                0
              );
              const canNudge = ["pending", "declined", "expired"].includes(member.inviteStatus || "") && resendWaitSeconds === 0;
              const blocker = describeBlocker(member);
              const emailChanged = Boolean(
                member.originalEmail &&
                member.email.trim().toLowerCase() !== member.originalEmail.trim().toLowerCase()
              );
              return (
                <div key={member.key} className="grid min-w-0 gap-4 border border-white/8 bg-white/[0.025] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <p className="text-sm font-semibold text-white">Roster member {index + 1}</p>
                      {member.inviteStatus ? <Badge>{INVITE_STATUS_LABELS[member.inviteStatus]}</Badge> : <Badge>Not invited yet</Badge>}
                    </div>
                    <button type="button" className="text-sm text-rose-300 hover:text-rose-200" onClick={() => setMembers((current) => current.filter((item) => item.key !== member.key))}>Remove</button>
                  </div>
                  {member.inviteStatus ? (
                    <div className="grid gap-2 border border-white/8 bg-black/15 px-3 py-2 text-xs text-slate-400">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span>
                          {member.inviteStatus === "pending"
                            ? `Waiting for them to accept${member.inviteSentAt ? ` · invited ${new Date(member.inviteSentAt).toLocaleString()}` : ""}`
                            : member.inviteStatus === "accepted"
                              ? "Accepted"
                              : member.inviteStatus === "expired"
                                ? "Nobody answered before the deadline"
                                : "Declined"}
                        </span>
                        {["pending", "declined", "expired"].includes(member.inviteStatus) ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button type="button" variant="secondary" disabled={!canNudge || emailChanged || Boolean(nudgingMemberId) || saving} onClick={() => void nudgeInvite(member)}>
                              {nudgingMemberId === member.key ? "Sending..." : emailChanged ? "Save email change first" : resendWaitSeconds > 0 ? `Remind again in ${resendWaitSeconds}s` : member.inviteStatus === "pending" ? "Remind" : "Invite again"}
                            </Button>
                            <Button type="button" variant="secondary" onClick={() => void copyInvitationLink(member)}>
                              {copiedMemberKey === member.key ? "Link copied" : "Copy invite link"}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      {blocker ? (
                        <p className="text-amber-200/90">{blocker}</p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Role"><Select value={member.role} onChange={(event) => updateMember(member.key, { role: event.target.value as EditableMember["role"] })}><option value="PLAYER">Player</option><option value="SUBSTITUTE">Substitute</option><option value="COACH">Coach</option></Select></FormField>
                    <FormField label="Name" required><Input required value={member.name} onChange={(event) => updateMember(member.key, { name: event.target.value })} /></FormField>
                    <FormField label="Email" required><Input required type="email" value={member.email} onChange={(event) => updateMember(member.key, { email: event.target.value })} /></FormField>
                    <FormField label="Phone"><Input type="tel" maxLength={50} value={member.phone} onChange={(event) => updateMember(member.key, { phone: event.target.value })} /></FormField>
                    <FormField label="Discord"><Input value={member.discord} onChange={(event) => updateMember(member.key, { discord: event.target.value })} /></FormField>
                    <FormField label="IGN / Game ID"><Input value={member.riotId} placeholder="Exact in-game name or player ID" onChange={(event) => updateMember(member.key, { riotId: event.target.value })} /></FormField>
                  </div>
                </div>
              );
            })}
          </section>

          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          <div className="border-t border-white/10 pt-5">
            {!selectedTeam.canDelete ? <p className="mb-3 text-sm text-amber-200">This team cannot be deleted because it has a tournament registration.</p> : null}
            <div className="grid gap-3 sm:flex sm:flex-wrap sm:justify-between"><Button type="button" variant="danger" disabled={deleting || saving || !selectedTeam.canDelete} onClick={() => void removeTeam()}>{deleting ? "Deleting..." : "Delete Team"}</Button><Button type="submit" disabled={saving || deleting}>{saving ? "Saving..." : "Save Team Changes"}</Button></div>
          </div>
        </form>
      )}
    </div>
  );
}
