"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToastStore } from "@/hooks/useToastStore";
import { adminRequest } from "@/lib/admin";

type Team = {
  id: string;
  name: string;
  country: string | null;
  organizationName: string;
  captainName: string;
  memberCount: number;
};

export default function AdminTeamsManager() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const data = await adminRequest<{ teams: Team[] }>("/api/admin/teams");
    setTeams(data.teams);
  }, []);

  useEffect(() => {
    void adminRequest<{ teams: Team[] }>("/api/admin/teams")
      .then((data) => setTeams(data.teams))
      .catch((error) =>
        setMessage(error instanceof Error ? error.message : "Unable to load teams.")
      );
  }, []);

  return (
    <AdminShell
      title="Teams"
      description="Verify public organization labels or remove saved teams. Captains cannot set organization labels themselves."
    >
      {message ? <p className="mb-4 text-sm text-slate-300">{message}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {teams.map((team) => (
          <TeamCard key={team.id} team={team} onChanged={load} />
        ))}
      </div>
    </AdminShell>
  );
}

function TeamCard({ team, onChanged }: { team: Team; onChanged: () => Promise<void> }) {
  const [organization, setOrganization] = useState(team.organizationName);
  const [busyAction, setBusyAction] = useState<"verify" | "delete" | null>(null);
  const showToast = useToastStore((state) => state.showToast);

  const verifyOrganization = async () => {
    setBusyAction("verify");
    try {
      await adminRequest(`/api/admin/teams/${team.id}/organization`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationName: organization }),
      });
      showToast({ tone: "success", title: "Team organization updated" });
      await onChanged();
    } catch (error) {
      showToast({
        tone: "error",
        title: "Unable to update team",
        description: error instanceof Error ? error.message : "Request failed.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const deleteTeam = async () => {
    if (
      !window.confirm(
        `Delete ${team.name}? Its saved roster and pending invites will be removed. Tournament registrations will remain.`
      )
    ) {
      return;
    }

    setBusyAction("delete");
    try {
      await adminRequest(`/api/admin/teams/${team.id}`, { method: "DELETE" });
      showToast({ tone: "success", title: "Team deleted" });
      await onChanged();
    } catch (error) {
      showToast({
        tone: "error",
        title: "Unable to delete team",
        description: error instanceof Error ? error.message : "Request failed.",
      });
      setBusyAction(null);
    }
  };

  return (
    <Card className="p-5">
      <h3 className="text-xl text-white">{team.name}</h3>
      <p className="mt-1 text-sm text-slate-400">
        Captain {team.captainName} · {team.memberCount} roster members
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label={`Organization for ${team.name}`}
          value={organization}
          onChange={(event) => setOrganization(event.target.value)}
          placeholder="Independent"
        />
        <Button
          type="button"
          disabled={busyAction !== null}
          onClick={() => void verifyOrganization()}
        >
          {busyAction === "verify" ? "Saving..." : "Verify"}
        </Button>
        <Button
          type="button"
          variant="danger"
          disabled={busyAction !== null}
          onClick={() => void deleteTeam()}
        >
          {busyAction === "delete" ? "Deleting..." : "Delete"}
        </Button>
      </div>
    </Card>
  );
}
