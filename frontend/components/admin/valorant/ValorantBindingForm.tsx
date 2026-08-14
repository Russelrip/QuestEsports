"use client";

import { useState } from "react";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
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
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const bindableTeams = teams.filter(
    (team) => !bindings.some((binding) => binding.savedTeamId === team.id && binding.status === "active")
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTeamId || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await bindValorantTeam(selectedTeamId);
      showToast({ title: "Team bound", tone: "success" });
      setSelectedTeamId("");
      await onBound();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Could not bind this team.";
      setError(message);
      showToast({ title: message, tone: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6">
      <h3 className="text-lg font-semibold text-white">Bind a SavedTeam</h3>
      {error ? <ValorantErrorAlert message={error} /> : null}
      <form onSubmit={handleSubmit} className="mt-4 grid gap-3">
        <div className="grid min-w-0 gap-2">
          <label htmlFor="saved-team-to-bind" className="text-sm font-medium text-slate-300">
            Saved team to bind
          </label>
          <Select
            id="saved-team-to-bind"
            aria-label="Saved team to bind"
            value={selectedTeamId}
            onChange={(event) => setSelectedTeamId(event.target.value)}
            disabled={bindableTeams.length === 0 || submitting}
          >
            <option value="">
              {bindableTeams.length === 0
                ? "All of your SavedTeams are already bound."
                : "Select a SavedTeam to bind..."}
            </option>
            {bindableTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
                {team.teamTag ? ` (${team.teamTag})` : ""}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Button type="submit" disabled={submitting || !selectedTeamId}>
            Bind to VALORANT
          </Button>
        </div>
      </form>
    </Card>
  );
}
