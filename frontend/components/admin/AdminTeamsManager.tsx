"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { useToastStore } from "@/hooks/useToastStore";
import { adminRequest } from "@/lib/admin";

type TeamMember = { id: string; role: "CAPTAIN" | "PLAYER" | "SUBSTITUTE" | "COACH"; name: string; email: string; discord: string | null; gameId: string | null; inviteStatus: string };
type Team = { id: string; name: string; teamTag: string | null; country: string | null; organizationName: string; captainName: string; memberCount: number; members: TeamMember[] };

export default function AdminTeamsManager() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const data = await adminRequest<{ teams: Team[] }>("/api/admin/teams");
      setTeams(data.teams);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load teams.");
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const filteredTeams = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return teams;
    return teams.filter((team) => [
      team.name,
      team.teamTag,
      team.country,
      team.organizationName,
      team.captainName,
      ...team.members.flatMap((member) => [member.name, member.email, member.discord, member.gameId]),
    ].some((value) => value?.toLowerCase().includes(query)));
  }, [search, teams]);

  return (
    <AdminShell title="Teams" description="Edit saved team details, player game IDs, and roster information. Changes here do not rewrite past tournament registrations.">
      <Card className="p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h3 className="text-2xl text-white">Saved teams</h3>
            <p className="mt-1 text-sm text-slate-400">{teams.length} team{teams.length === 1 ? "" : "s"} in the directory</p>
          </div>
          <Input className="lg:max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search teams, captains, or players..." aria-label="Search teams" />
        </div>
      </Card>
      {message ? <p className="text-sm text-rose-300">{message}</p> : null}
      {loading ? (
        <Card className="p-4 sm:p-6"><AdminTableSkeleton /></Card>
      ) : filteredTeams.length === 0 ? (
        <EmptyState description={teams.length === 0 ? "No saved teams yet." : "No teams matched your search."} />
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">{filteredTeams.map((team) => <TeamCard key={team.id} team={team} onChanged={load} />)}</div>
      )}
    </AdminShell>
  );
}

function TeamCard({ team, onChanged }: { team: Team; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(team.name);
  const [teamTag, setTeamTag] = useState(team.teamTag || "");
  const [country, setCountry] = useState(team.country || "");
  const [organization, setOrganization] = useState(team.organizationName);
  const [members, setMembers] = useState(team.members);
  const [busyAction, setBusyAction] = useState<"save" | "delete" | null>(null);
  const showToast = useToastStore((state) => state.showToast);

  useEffect(() => {
    setName(team.name);
    setTeamTag(team.teamTag || "");
    setCountry(team.country || "");
    setOrganization(team.organizationName);
    setMembers(team.members);
  }, [team]);

  const updateMember = (id: string, field: keyof TeamMember, value: string) => setMembers((current) => current.map((member) => member.id === id ? { ...member, [field]: value } : member));
  const saveTeam = async () => {
    setBusyAction("save");
    try {
      await adminRequest(`/api/admin/teams/${team.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, teamTag, country, organizationName: organization, members }) });
      showToast({ tone: "success", title: "Team updated" });
      await onChanged();
    } catch (error) {
      showToast({ tone: "error", title: "Unable to update team", description: error instanceof Error ? error.message : "Request failed." });
    } finally { setBusyAction(null); }
  };

  const deleteTeam = async () => {
    if (!window.confirm(`Delete ${team.name}? Its saved roster and pending invites will be removed. Tournament registrations will remain.`)) return;
    setBusyAction("delete");
    try {
      await adminRequest(`/api/admin/teams/${team.id}`, { method: "DELETE" });
      showToast({ tone: "success", title: "Team deleted" });
      await onChanged();
    } catch (error) {
      showToast({ tone: "error", title: "Unable to delete team", description: error instanceof Error ? error.message : "Request failed." });
      setBusyAction(null);
    }
  };

  return (
    <Card className="min-w-0 overflow-hidden p-4 sm:p-5">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="break-words text-xl text-white">{team.name}</h3>
          <p className="mt-1 break-words text-sm text-slate-400">Captain {team.captainName} · {team.memberCount} roster member{team.memberCount === 1 ? "" : "s"}</p>
        </div>
        {team.teamTag ? <span className="w-fit shrink-0 border border-purple-300/20 bg-purple-400/10 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-purple-100">{team.teamTag}</span> : null}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Team name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Team tag"><Input value={teamTag} onChange={(event) => setTeamTag(event.target.value)} placeholder="QST" /></Field>
        <Field label="Country"><Input value={country} onChange={(event) => setCountry(event.target.value)} /></Field>
        <Field label="Verified organization"><Input value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="Independent" /></Field>
      </div>
      <div className="mt-5 space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Roster</h4>
        {members.map((member) => (
          <div key={member.id} className="min-w-0 border border-white/10 bg-black/15 p-3 sm:p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Player name"><Input value={member.name} onChange={(event) => updateMember(member.id, "name", event.target.value)} /></Field>
              <Field label="Role"><div className="flex h-12 items-center border border-white/10 bg-white/5 px-4 text-sm capitalize text-slate-300">{member.role.toLowerCase()}</div></Field>
              <Field label="Email"><Input type="email" value={member.email} onChange={(event) => updateMember(member.id, "email", event.target.value)} /></Field>
              <Field label="Game ID"><Input value={member.gameId || ""} onChange={(event) => updateMember(member.id, "gameId", event.target.value)} placeholder="Player ID / Riot ID" /></Field>
              <Field label="Discord"><Input value={member.discord || ""} onChange={(event) => updateMember(member.id, "discord", event.target.value)} /></Field>
              <p className="break-words self-end pb-2 text-xs capitalize text-slate-500">Invite: {member.inviteStatus.replaceAll("_", " ")}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button type="button" className="w-full sm:w-auto" disabled={busyAction !== null} onClick={() => void saveTeam()}>{busyAction === "save" ? "Saving..." : "Save changes"}</Button>
        <Button type="button" className="w-full sm:w-auto" variant="danger" disabled={busyAction !== null} onClick={() => void deleteTeam()}>{busyAction === "delete" ? "Deleting..." : "Delete"}</Button>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid min-w-0 gap-1 text-sm text-slate-300"><span>{label}</span>{children}</label>; }
