"use client";

import { useState } from "react";
import ValorantBindingForm from "@/components/admin/valorant/ValorantBindingForm";
import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import ValorantStatusBadge from "@/components/admin/valorant/ValorantStatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAdminTeams } from "@/hooks/api/useAdmin";
import { useValorantBindings } from "@/hooks/api/useValorant";
import { useToastStore } from "@/hooks/useToastStore";
import { formatAdminCompactDateTime } from "@/lib/admin";
import type { Binding } from "@/lib/valorant";
import { detachValorantBinding } from "@/lib/valorant-api";

export default function ValorantTeamsManager() {
  const showToast = useToastStore((state) => state.showToast);
  const bindingsQuery = useValorantBindings();
  const teamsQuery = useAdminTeams();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [detaching, setDetaching] = useState(false);

  const bindings = bindingsQuery.data?.bindings ?? [];
  const teams = teamsQuery.data ?? [];
  const loading = bindingsQuery.loading || teamsQuery.loading;
  const error = bindingsQuery.error || teamsQuery.error;

  const handleDetach = async (binding: Binding) => {
    if (confirmingId !== binding.id) {
      setConfirmingId(binding.id);
      return;
    }
    setConfirmingId(null);
    setDetaching(true);
    try {
      await detachValorantBinding(binding.id);
      showToast({ title: "Binding detached", tone: "success" });
      await bindingsQuery.refetch();
    } catch (detachError) {
      const message = detachError instanceof Error ? detachError.message : "Could not detach this binding.";
      showToast({ title: message, tone: "error" });
    } finally {
      setDetaching(false);
    }
  };

  return (
    <div className="grid min-w-0 gap-4 sm:gap-6">
      <div>
        <h3 className="text-lg font-semibold text-white">Team Bindings</h3>
        <p className="text-sm text-slate-400">
          Link Quest SavedTeams to VALORANT platform teams. One active binding per team; detaching never deletes VALORANT data.
        </p>
      </div>

      {error ? (
        <ValorantErrorAlert
          message={error}
          onRetry={() => {
            void bindingsQuery.refetch();
            void teamsQuery.refetch();
          }}
        />
      ) : loading ? (
        <ValorantLoadingState />
      ) : (
        <>
          <ValorantBindingForm teams={teams} bindings={bindings} onBound={async () => { await bindingsQuery.refetch(); }} />
          {bindings.length === 0 ? (
            <ValorantEmptyState
              title="No bindings yet"
              description="Bind a SavedTeam to start running VALORANT series."
            />
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                {bindings.map((binding) => (
                  <Card key={binding.id} className="p-5">
                    <div className="flex min-w-0 items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h4 className="text-lg text-white">
                          {binding.savedTeam ? binding.savedTeam.name : "Detached team"}
                          {binding.savedTeam?.teamTag ? (
                            <span className="ml-2 text-sm text-slate-400">({binding.savedTeam.teamTag})</span>
                          ) : null}
                        </h4>
                        <p className="mt-1 truncate font-mono text-xs text-slate-500" title={binding.valorantTeamUuid}>
                          {binding.valorantTeamUuid.slice(0, 8)}…
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
                          <ValorantStatusBadge status={binding.status} kind="binding" />
                          {binding.boundByUser ? <span>Bound by {binding.boundByUser.username}</span> : null}
                          <span>{formatAdminCompactDateTime(binding.boundAt)}</span>
                        </div>
                      </div>
                      {binding.status === "active" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={detaching}
                          onClick={() => void handleDetach(binding)}
                        >
                          {confirmingId === binding.id ? "Confirm detach?" : "Detach binding"}
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                ))}
              </div>
              <p className="text-sm text-slate-500">
                Detaching never deletes VALORANT teams, series, or rating history.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
