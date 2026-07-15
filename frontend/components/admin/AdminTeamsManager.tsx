"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { adminRequest } from "@/lib/admin";

type Team = { id: string; name: string; country: string | null; organizationName: string; captainName: string; memberCount: number };
export default function AdminTeamsManager() {
  const [teams, setTeams] = useState<Team[]>([]); const [message, setMessage] = useState("");
  const load = async () => setTeams((await adminRequest<{ teams: Team[] }>("/api/admin/teams")).teams);
  useEffect(() => { void adminRequest<{ teams: Team[] }>("/api/admin/teams").then((data) => setTeams(data.teams)).catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load teams.")); }, []);
  return <AdminShell title="Teams" description="Verify public organization labels. Captains cannot set these labels themselves.">{message ? <p className="mb-4 text-sm text-slate-300">{message}</p> : null}<div className="grid gap-4 md:grid-cols-2">{teams.map((team) => <TeamCard key={team.id} team={team} onSaved={load} />)}</div></AdminShell>;
}
function TeamCard({ team, onSaved }: { team: Team; onSaved: () => Promise<void> }) { const [organization, setOrganization] = useState(team.organizationName); return <Card className="p-5"><h3 className="text-xl text-white">{team.name}</h3><p className="mt-1 text-sm text-slate-400">Captain {team.captainName} · {team.memberCount} roster members</p><div className="mt-4 flex gap-2"><Input aria-label={`Organization for ${team.name}`} value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="Independent" /><Button onClick={async () => { await adminRequest(`/api/admin/teams/${team.id}/organization`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationName: organization }) }); await onSaved(); }}>Verify</Button></div></Card>; }
