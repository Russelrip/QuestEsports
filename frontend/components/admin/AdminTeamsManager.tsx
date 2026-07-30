"use client";

import Image from "next/image";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useToastStore } from "@/hooks/useToastStore";
import { buildApiUrl } from "@/lib/api";
import {
  adminRequest,
  getAdminPaginationSummary,
  type Pagination,
} from "@/lib/admin";
import {
  TEAM_LOGO_MAX_FILE_SIZE,
  assertFileWithinUploadLimit,
} from "@/lib/upload-limits";

type TeamMember = {
  id: string;
  role: "CAPTAIN" | "PLAYER" | "SUBSTITUTE" | "COACH";
  name: string;
  email: string;
  discord: string | null;
  gameId: string | null;
  inviteStatus: string;
};

type TeamSummary = {
  id: string;
  name: string;
  teamTag: string | null;
  logoUrl: string | null;
  country: string | null;
  organizationName: string;
  captainName: string;
  memberCount: number;
  updatedAt: string;
};

type TeamDetail = TeamSummary & { members: TeamMember[] };

export default function AdminTeamsManager() {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<TeamDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const loadTeams = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "15" });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      const data = await adminRequest<{ teams: TeamSummary[]; pagination: Pagination }>(
        `/api/admin/teams?${params}`
      );
      setTeams(data.teams);
      setPagination(data.pagination);
      setListError("");
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Unable to load teams.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    if (!selectedTeamId) {
      setSelectedTeam(null);
      setDetailError("");
      return;
    }

    let active = true;
    setDetailLoading(true);
    setDetailError("");
    void adminRequest<{ team: TeamDetail }>(`/api/admin/teams/${selectedTeamId}`)
      .then((data) => {
        if (active) setSelectedTeam(data.team);
      })
      .catch((error) => {
        if (active) setDetailError(error instanceof Error ? error.message : "Unable to load this team.");
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedTeamId]);

  const reloadSelectedTeam = useCallback(async () => {
    if (!selectedTeamId) return;
    const data = await adminRequest<{ team: TeamDetail }>(`/api/admin/teams/${selectedTeamId}`);
    setSelectedTeam(data.team);
    await loadTeams();
  }, [loadTeams, selectedTeamId]);

  const handleDeleted = async () => {
    setSelectedTeamId(null);
    setSelectedTeam(null);
    if (teams.length === 1 && page > 1) {
      setPage((current) => current - 1);
    } else {
      await loadTeams();
    }
  };

  return (
    <AdminShell
      title="Teams"
      description="Browse a lightweight team directory, then open one roster to review or edit its full details."
    >
      {selectedTeamId ? (
        <TeamDetailView
          team={selectedTeam}
          loading={detailLoading}
          error={detailError}
          onBack={() => setSelectedTeamId(null)}
          onChanged={reloadSelectedTeam}
          onDeleted={handleDeleted}
        />
      ) : (
        <>
          <Card className="p-4 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <h3 className="text-2xl text-white">Saved teams</h3>
                <p className="mt-1 text-sm text-slate-400">
                  {pagination ? `${pagination.total} team${pagination.total === 1 ? "" : "s"} in the directory` : "Loading directory..."}
                </p>
              </div>
              <Input
                className="lg:max-w-md"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search teams, captains, or players..."
                aria-label="Search teams"
              />
            </div>
          </Card>

          {listError ? <p className="text-sm text-rose-300">{listError}</p> : null}
          {loading ? (
            <Card className="p-4 sm:p-6"><AdminTableSkeleton /></Card>
          ) : teams.length === 0 ? (
            <EmptyState description={debouncedSearch ? "No teams matched your search." : "No saved teams yet."} />
          ) : (
            <Card className="min-w-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-left">
                  <thead className="border-b border-white/10 bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-5 py-4 font-semibold">Team</th>
                      <th className="px-5 py-4 font-semibold">Captain</th>
                      <th className="px-5 py-4 font-semibold">Country</th>
                      <th className="px-5 py-4 font-semibold">Organization</th>
                      <th className="px-5 py-4 text-center font-semibold">Roster</th>
                      <th className="px-5 py-4 text-right font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/8">
                    {teams.map((team) => (
                      <tr key={team.id} className="transition hover:bg-purple-300/[0.04]">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <TeamLogo team={team} size="small" />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-white">{team.name}</p>
                              <p className="mt-1 text-xs uppercase tracking-wider text-purple-200/70">{team.teamTag || "No tag"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-300">{team.captainName}</td>
                        <td className="px-5 py-4 text-sm text-slate-400">{team.country || "Not set"}</td>
                        <td className="px-5 py-4 text-sm text-slate-400">{team.organizationName}</td>
                        <td className="px-5 py-4 text-center text-sm font-semibold text-slate-200">{team.memberCount}</td>
                        <td className="px-5 py-4 text-right">
                          <Button type="button" variant="secondary" onClick={() => setSelectedTeamId(team.id)}>
                            View & edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pagination ? (
                <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-400">{getAdminPaginationSummary(pagination, "teams")}</p>
                  <div className="flex gap-3">
                    <Button type="button" variant="secondary" disabled={pagination.page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button>
                    <Button type="button" variant="secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Next</Button>
                  </div>
                </div>
              ) : null}
            </Card>
          )}
        </>
      )}
    </AdminShell>
  );
}

function TeamDetailView({
  team,
  loading,
  error,
  onBack,
  onChanged,
  onDeleted,
}: {
  team: TeamDetail | null;
  loading: boolean;
  error: string;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <div>
        <Button type="button" variant="secondary" onClick={onBack}>← Back to team directory</Button>
      </div>
      {error ? <Card className="p-6"><p className="text-sm text-rose-300">{error}</p></Card> : null}
      {loading ? <Card className="p-4 sm:p-6"><AdminTableSkeleton /></Card> : null}
      {!loading && team ? <TeamEditor team={team} onChanged={onChanged} onDeleted={onDeleted} /> : null}
    </div>
  );
}

function TeamEditor({ team, onChanged, onDeleted }: { team: TeamDetail; onChanged: () => Promise<void>; onDeleted: () => Promise<void> }) {
  const [name, setName] = useState(team.name);
  const [teamTag, setTeamTag] = useState(team.teamTag || "");
  const [country, setCountry] = useState(team.country || "");
  const [organization, setOrganization] = useState(team.organizationName);
  const [members, setMembers] = useState(team.members);
  const [teamLogo, setTeamLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busyAction, setBusyAction] = useState<"save" | "delete" | null>(null);
  const showToast = useToastStore((state) => state.showToast);

  useEffect(() => {
    setName(team.name);
    setTeamTag(team.teamTag || "");
    setCountry(team.country || "");
    setOrganization(team.organizationName);
    setMembers(team.members);
    setTeamLogo(null);
    setRemoveLogo(false);
  }, [team]);

  const updateMember = (id: string, field: keyof TeamMember, value: string) => {
    setMembers((current) => current.map((member) => member.id === id ? { ...member, [field]: value } : member));
  };

  const saveTeam = async () => {
    setBusyAction("save");
    try {
      assertFileWithinUploadLimit(teamLogo, TEAM_LOGO_MAX_FILE_SIZE, "Team logo");
      const body = new FormData();
      body.append("name", name);
      body.append("teamTag", teamTag);
      body.append("country", country);
      body.append("organizationName", organization);
      body.append("members", JSON.stringify(members));
      body.append("removeLogo", String(removeLogo));
      if (teamLogo) body.append("teamLogo", teamLogo);
      await adminRequest(`/api/admin/teams/${team.id}`, {
        method: "PATCH",
        body,
      });
      showToast({ tone: "success", title: "Team updated" });
      await onChanged();
    } catch (error) {
      showToast({ tone: "error", title: "Unable to update team", description: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setBusyAction(null);
    }
  };

  const deleteTeam = async () => {
    if (!window.confirm(`Delete ${team.name}? Its saved roster and pending invites will be removed. Tournament registrations will remain.`)) return;
    setBusyAction("delete");
    try {
      await adminRequest(`/api/admin/teams/${team.id}`, { method: "DELETE" });
      showToast({ tone: "success", title: "Team deleted" });
      await onDeleted();
    } catch (error) {
      showToast({ tone: "error", title: "Unable to delete team", description: error instanceof Error ? error.message : "Request failed." });
      setBusyAction(null);
    }
  };

  return (
    <Card className="min-w-0 overflow-hidden p-4 sm:p-6">
      <div className="flex min-w-0 flex-col gap-2 border-b border-white/10 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <TeamLogo team={team} size="large" />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-purple-200">Team details</p>
            <h3 className="mt-2 break-words text-2xl text-white">{team.name}</h3>
            <p className="mt-1 break-words text-sm text-slate-400">Captain {team.captainName} · {team.memberCount} roster member{team.memberCount === 1 ? "" : "s"}</p>
          </div>
        </div>
        {team.teamTag ? <span className="w-fit shrink-0 border border-purple-300/20 bg-purple-400/10 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-purple-100">{team.teamTag}</span> : null}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Field label="Team name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Team tag"><Input value={teamTag} onChange={(event) => setTeamTag(event.target.value)} placeholder="QST" /></Field>
        <Field label="Country"><Input value={country} onChange={(event) => setCountry(event.target.value)} /></Field>
        <Field label="Verified organization"><Input value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="Independent" /></Field>
      </div>

      <div className="mt-5 grid gap-3 border border-white/10 bg-black/15 p-4">
        <Field label={team.logoUrl ? "Replace team logo" : "Add team logo"}>
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              setTeamLogo(event.target.files?.[0] || null);
              setRemoveLogo(false);
            }}
          />
        </Field>
        <p className="text-xs text-slate-500">PNG, JPG, or WebP · Maximum 5 MB. Changes also apply to this team in tournaments.</p>
        {teamLogo ? <p className="text-sm text-purple-200">Selected: {teamLogo.name}</p> : null}
        {team.logoUrl ? (
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={removeLogo}
              onChange={(event) => {
                setRemoveLogo(event.target.checked);
                if (event.target.checked) setTeamLogo(null);
              }}
            />
            Remove current logo everywhere
          </label>
        ) : null}
      </div>

      <div className="mt-7 space-y-3">
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Roster</h4>
          <p className="mt-1 text-xs text-slate-500">Game ID changes apply to this saved team only. Existing tournament registrations keep their own Game IDs.</p>
        </div>
        {members.map((member) => (
          <div key={member.id} className="min-w-0 border border-white/10 bg-black/15 p-3 sm:p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

      <div className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button type="button" className="w-full sm:w-auto" disabled={busyAction !== null} onClick={() => void saveTeam()}>{busyAction === "save" ? "Saving..." : "Save changes"}</Button>
        <Button type="button" className="w-full sm:w-auto" variant="danger" disabled={busyAction !== null} onClick={() => void deleteTeam()}>{busyAction === "delete" ? "Deleting..." : "Delete team"}</Button>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid min-w-0 gap-1 text-sm text-slate-300"><span>{label}</span>{children}</label>;
}

function TeamLogo({ team, size }: { team: TeamSummary; size: "small" | "large" }) {
  const dimensions = size === "large" ? "h-20 w-20" : "h-11 w-11";
  return team.logoUrl ? (
    <div className={`relative shrink-0 overflow-hidden border border-white/10 bg-white/5 ${dimensions}`}>
      <Image
        src={buildApiUrl(team.logoUrl)}
        alt={`${team.name} logo`}
        fill
        sizes={size === "large" ? "80px" : "44px"}
        className="object-contain p-1"
      />
    </div>
  ) : (
    <div className={`flex shrink-0 items-center justify-center border border-dashed border-white/15 bg-white/[0.03] text-[10px] uppercase tracking-wider text-slate-500 ${dimensions}`}>
      No logo
    </div>
  );
}
