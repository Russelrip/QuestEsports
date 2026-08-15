"use client";

import { useState } from "react";
import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import ValorantRatingHistoryPanel from "@/components/admin/valorant/ValorantRatingHistoryPanel";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useValorantBindings, useValorantRankings } from "@/hooks/api/useValorant";
import { cn } from "@/lib/utils";
import { joinRankingsWithBindings, type RankingEntry } from "@/lib/valorant";

type JoinedRanking = RankingEntry & { teamLabel: string };

export default function ValorantRankingsManager() {
  const [selected, setSelected] = useState<JoinedRanking | null>(null);
  const rankingsQuery = useValorantRankings();
  const bindingsQuery = useValorantBindings();

  const rankings = rankingsQuery.data?.rankings ?? [];
  const bindings = bindingsQuery.data?.bindings ?? [];
  const rows = joinRankingsWithBindings(rankings, bindings).sort((a, b) => a.rank - b.rank);

  const loading = rankingsQuery.loading || bindingsQuery.loading;
  const error = rankingsQuery.error || bindingsQuery.error;
  const retry = () => {
    void rankingsQuery.refetch();
    void bindingsQuery.refetch();
  };

  return (
    <div className="grid min-w-0 gap-4 sm:gap-6">
      <div>
        <h3 className="text-lg font-semibold text-white">VALORANT Rankings</h3>
        <p className="text-sm text-slate-400">
          Admin-only standings and rating history. Quest never computes ELO — rankings come from the VALORANT platform.
        </p>
      </div>

      {error ? (
        <ValorantErrorAlert message={error} onRetry={retry} />
      ) : loading ? (
        <ValorantLoadingState />
      ) : rankings.length === 0 ? (
        <ValorantEmptyState
          title="No rankings yet"
          description="Finalize a rated series to generate ELO standings."
        />
      ) : (
        <>
          <Card className="min-w-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    <th scope="col" aria-label="Rank" className="px-4 py-3">#</th>
                    <th scope="col" aria-label="Team" className="px-4 py-3">Team</th>
                    <th scope="col" aria-label="ELO" className="px-4 py-3">ELO</th>
                    <th scope="col" aria-label="Series (W-L)" className="px-4 py-3">Series (W-L)</th>
                    <th scope="col" className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => {
                    const isSelected = selected?.teamId === entry.teamId;
                    return (
                      <tr
                        key={entry.teamId}
                        onClick={() => setSelected(entry)}
                        className={cn(
                          "border-b border-white/5 last:border-0",
                          isSelected ? "bg-fuchsia-400/10" : "cursor-pointer transition hover:bg-white/5"
                        )}
                      >
                        <td className="px-4 py-4 font-semibold text-white">{entry.rank}</td>
                        <td className="px-4 py-4 text-slate-300">{entry.teamLabel}</td>
                        <td className="px-4 py-4 whitespace-nowrap font-semibold text-white">{entry.elo}</td>
                        <td className="px-4 py-4 whitespace-nowrap text-slate-300">
                          {entry.seriesWins} - {entry.seriesLosses}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <button
                            type="button"
                            className={buttonClassName({ variant: "secondary", size: "sm" })}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelected(entry);
                            }}
                          >
                            {isSelected ? "Selected" : "History"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {selected ? (
            <ValorantRatingHistoryPanel teamId={selected.teamId} teamLabel={selected.teamLabel} />
          ) : null}
        </>
      )}
    </div>
  );
}
