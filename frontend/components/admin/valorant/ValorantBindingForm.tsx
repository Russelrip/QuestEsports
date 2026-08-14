"use client";

import { useState } from "react";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToastStore } from "@/hooks/useToastStore";
import type { AdminTeamOption } from "@/hooks/api/useAdmin";
import type { Binding } from "@/lib/valorant";
import { bindValorantTeam } from "@/lib/valorant-api";

export default function ValorantBindingForm({
  teams,
  bindings,
  onBound,
}: {
  teams: AdminTeamOption[];
  bindings: Binding[];
  onBound: () => Promise<void>;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const bindableTeams = teams.filter(
    (team) => !bindings.some((binding) => binding.savedTeamId === team.id && binding.status === "active")
  );

  const toggleTeam = (teamId: string) => {
    setSelectedTeamIds((current) =>
      current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId]
    );
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedTeamIds.length === 0 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const succeeded: string[] = [];
      const failedNames: string[] = [];
      for (const teamId of selectedTeamIds) {
        const team = bindableTeams.find((candidate) => candidate.id === teamId);
        try {
          await bindValorantTeam(teamId);
          succeeded.push(teamId);
        } catch {
          failedNames.push(team ? team.name : teamId);
        }
      }
      const succeededSet = new Set(succeeded);
      setSelectedTeamIds((current) => current.filter((id) => !succeededSet.has(id)));
      if (failedNames.length === 0) {
        showToast({
          title: `${succeeded.length} team${succeeded.length === 1 ? "" : "s"} bound`,
          tone: "success",
        });
      } else {
        const summary =
          succeeded.length === 0
            ? failedNames.length === 1
              ? `Could not bind ${failedNames[0]}.`
              : `Could not bind ${failedNames.length} teams: ${failedNames.join(", ")}.`
            : `${succeeded.length} bound, ${failedNames.length} failed: ${failedNames.join(", ")}`;
        setError(summary);
        showToast({ title: summary, tone: "error" });
      }
      if (succeeded.length > 0) {
        await onBound();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6">
      <h3 className="text-lg font-semibold text-white">Bind a SavedTeam</h3>
      {error ? <ValorantErrorAlert message={error} /> : null}
      <form onSubmit={handleSubmit} className="mt-4 grid gap-3">
        <fieldset>
          <legend className="text-sm font-medium text-slate-300">Saved team to bind</legend>
          {bindableTeams.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">All of your SavedTeams are already bound.</p>
          ) : (
            <div className="mt-2 grid gap-2">
              {bindableTeams.map((team) => (
                <label
                  key={team.id}
                  className="flex min-w-0 items-start gap-3 text-sm text-slate-200"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 shrink-0"
                    checked={selectedTeamIds.includes(team.id)}
                    disabled={submitting}
                    onChange={() => toggleTeam(team.id)}
                  />
                  <span className="min-w-0 break-words">
                    {team.name}
                    {team.teamTag ? ` (${team.teamTag})` : ""}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div>
          <Button type="submit" disabled={submitting || selectedTeamIds.length === 0}>
            Bind selected ({selectedTeamIds.length})
          </Button>
        </div>
      </form>
    </Card>
  );
}
