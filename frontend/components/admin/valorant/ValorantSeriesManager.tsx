"use client";

import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import ValorantStatusBadge from "@/components/admin/valorant/ValorantStatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useValorantSeriesList } from "@/hooks/api/useValorant";
import { formatAdminCompactDateTime } from "@/lib/admin";
import { mapsForFormat, ratingModeLabel, type QuestValorantSeries } from "@/lib/valorant";

const teamLabel = (series: QuestValorantSeries, side: "A" | "B") => {
  const savedTeam = side === "A" ? series.bindingA.savedTeam : series.bindingB.savedTeam;
  if (!savedTeam) return "—";
  return savedTeam.teamTag ? `${savedTeam.name} (${savedTeam.teamTag})` : savedTeam.name;
};

export default function ValorantSeriesManager({
  onViewSeries,
  onCreateSeries,
}: {
  onViewSeries: (seriesId: string) => void;
  onCreateSeries: () => void;
}) {
  const seriesQuery = useValorantSeriesList();
  const series = seriesQuery.data?.series ?? [];
  const { loading, error, refetch } = seriesQuery;

  return (
    <div className="grid min-w-0 gap-4 sm:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">VALORANT Series</h3>
          <p className="text-sm text-slate-400">
            Create standalone BO1/BO3/BO5 draft series and manage their games.
          </p>
        </div>
        <Button type="button" onClick={onCreateSeries}>
          New series
        </Button>
      </div>

      {error ? (
        <ValorantErrorAlert message={error} onRetry={() => void refetch()} />
      ) : loading ? (
        <ValorantLoadingState />
      ) : series.length === 0 ? (
        <ValorantEmptyState
          title="No series yet"
          description="Create a standalone draft series between two bound teams."
        />
      ) : (
        <Card className="min-w-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  <th scope="col" className="px-4 py-3">Format</th>
                  <th scope="col" className="px-4 py-3">Played at</th>
                  <th scope="col" className="px-4 py-3">Team A</th>
                  <th scope="col" className="px-4 py-3">Team B</th>
                  <th scope="col" className="px-4 py-3">Games</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Rating</th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {series.map((item) => (
                  <tr key={item.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-4 font-semibold text-white">{item.format.toUpperCase()}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-slate-300">
                      {formatAdminCompactDateTime(item.playedAt)}
                    </td>
                    <td className="px-4 py-4 text-slate-300">{teamLabel(item, "A")}</td>
                    <td className="px-4 py-4 text-slate-300">{teamLabel(item, "B")}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-slate-300">
                      {item.games.length} / {mapsForFormat(item.format)}
                    </td>
                    <td className="px-4 py-4">
                      <ValorantStatusBadge status={item.status} kind="series" />
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-slate-300">
                      {item.ratingMode ?? item.ratingModePreference
                        ? ratingModeLabel(item.ratingMode ?? item.ratingModePreference)
                        : "—"}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => onViewSeries(item.id)}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
