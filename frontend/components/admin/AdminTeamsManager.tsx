"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToastStore } from "@/hooks/useToastStore";
import { adminRequest } from "@/lib/admin";

type TeamMember = { id: string; role: "CAPTAIN" | "PLAYER" | "SUBSTITUTE" | "COACH"; name: string; email: string; discord: string | null; gameId: string | null; inviteStatus: string };
type Team = { id: string; name: string; teamTag: string | null; country: string | null; organizationName: string; captainName: string; memberCount: number; members: TeamMember[] };

export default function AdminTeamsManager() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => setTeams((await adminRequest<{ teams: Team[] }>("/api/admin/teams")).teams), []);

  useEffect(() => {
    void adminRequest<{ teams: Team[] }>("/api/admin/teams")
      .then((data) => setTeams(data.teams))
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load teams."));
  }, []);

  return (
    <AdminShell title="Teams" description="Edit saved team details, player game IDs, and roster information. Changes here do not rewrite past tournament registrations.">
      {message ? <p className="mb-4 text-sm text-slate-300">{message}</p> : null}
      <div className="grid gap-4 xl:grid-cols-2">{teams.map((team) => <TeamCard key={team.id} team={team} onChanged={load} />)}</div>
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
    <Card className="p-5">
      <h3 className="text-xl text-white">{team.name}</h3>
      <p className="mt-1 text-sm text-slate-400">Captain {team.captainName} · {team.memberCount} roster members</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Team name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Team tag"><Input value={teamTag} onChange={(event) => setTeamTag(event.target.value)} placeholder="QST" /></Field>
        <Field label="Country"><Input value={country} onChange={(event) => setCountry(event.target.value)} /></Field>
        <Field label="Verified organization"><Input value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="Independent" /></Field>
      </div>
      <div className="mt-5 space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Roster</h4>
        {members.map((member) => (
          <div key={member.id} className="rounded-lg border border-white/10 bg-black/15 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Player name"><Input value={member.name} onChange={(event) => updateMember(member.id, "name", event.target.value)} /></Field>
              <Field label="Role"><div className="flex h-10 items-center rounded-md border border-white/10 bg-white/5 px-3 text-sm text-slate-300">{member.role.toLowerCase()}</div></Field>
              <Field label="Email"><Input type="email" value={member.email} onChange={(event) => updateMember(member.id, "email", event.target.value)} /></Field>
              <Field label="Game ID"><Input value={member.gameId || ""} onChange={(event) => updateMember(member.id, "gameId", event.target.value)} placeholder="Player ID / Riot ID" /></Field>
              <Field label="Discord"><Input value={member.discord || ""} onChange={(event) => updateMember(member.id, "discord", event.target.value)} /></Field>
              <p className="self-end pb-2 text-xs text-slate-500">Invite: {member.inviteStatus}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" disabled={busyAction !== null} onClick={() => void saveTeam()}>{busyAction === "save" ? "Saving..." : "Save changes"}</Button>
        <Button type="button" variant="danger" disabled={busyAction !== null} onClick={() => void deleteTeam()}>{busyAction === "delete" ? "Deleting..." : "Delete"}</Button>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1 text-sm text-slate-300"><span>{label}</span>{children}</label>; }
