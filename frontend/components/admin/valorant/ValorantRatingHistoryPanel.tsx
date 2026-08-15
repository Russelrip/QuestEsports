"use client";

import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import ValorantStatusBadge from "@/components/admin/valorant/ValorantStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useValorantRatingHistory, useValorantTeamSeries } from "@/hooks/api/useValorant";
import { formatAdminCompactDateTime } from "@/lib/admin";
import {
  formatEloDelta,
  ratingModeLabel,
  type ValorantSeriesStatus,
} from "@/lib/valorant";

export default function ValorantRatingHistoryPanel({
  teamId,
  teamLabel,
}: {
  teamId: string;
  teamLabel: string;
}) {
  const eventsQuery = useValorantRatingHistory(teamId, true);
  const seriesQuery = useValorantTeamSeries(teamId, true);

  const events = eventsQuery.data?.events ?? [];
  const series = seriesQuery.data?.series ?? [];
  const loading = eventsQuery.loading || seriesQuery.loading;
  const error = eventsQuery.error || seriesQuery.error;
  const retry = () => {
    void eventsQuery.refetch();
    void seriesQuery.refetch();
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-white/10 px-5 py-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Rating history
        </h3>
        <p className="mt-1 text-sm text-slate-300">{teamLabel}</p>
      </div>

      {error ? (
        <div className="p-5">
          <ValorantErrorAlert message={error} onRetry={retry} />
        </div>
      ) : loading ? (
        <div className="p-5">
          <ValorantLoadingState />
        </div>
      ) : events.length === 0 ? (
        <div className="p-5">
          <ValorantEmptyState
            title="No rating events yet"
            description="This team has no recorded ELO events yet."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                <th scope="col" className="px-5 py-3">Sequence</th>
                <th scope="col" className="px-5 py-3">Result</th>
                <th scope="col" className="px-5 py-3">ELO</th>
                <th scope="col" className="px-5 py-3">K-Factor</th>
                <th scope="col" className="px-5 py-3">Calculation details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-white/5 last:border-0">
                  <td className="px-5 py-4 whitespace-nowrap text-slate-300">{event.sequence}</td>
                  <td className="px-5 py-4">
                    <Badge className="border-white/10 bg-white/6 text-slate-200">{event.result}</Badge>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap text-slate-300">
                    <span className="font-semibold text-white">{event.eloBefore}</span>
                    {" → "}
                    <span className="font-semibold text-white">{event.eloAfter}</span>
                    <span className="ml-2 text-slate-400">
                      ({formatEloDelta(event.eloBefore, event.eloAfter)})
                    </span>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap text-slate-300">{event.kFactor ?? "—"}</td>
                  <td className="px-5 py-4">
                    <details>
                      <summary className="cursor-pointer text-xs text-slate-400 hover:text-white">
                        Details
                      </summary>
                      <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-400">
                        {JSON.stringify(event.calculationDetails, null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-white/10 px-5 py-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Team series
        </h3>
      </div>
      {series.length === 0 ? (
        <div className="px-5 pb-5">
          <ValorantEmptyState
            title="No series found for this team"
            description="This team has not played any series yet."
          />
        </div>
      ) : (
        <ul>
          {series.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/5 px-5 py-4 text-sm"
            >
              <span className="font-semibold text-white">{item.format.toUpperCase()}</span>
              <ValorantStatusBadge status={item.status as ValorantSeriesStatus} kind="series" />
              <span className="text-slate-300">{formatAdminCompactDateTime(item.playedAt)}</span>
              <span className="text-slate-400">{ratingModeLabel(item.ratingMode)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
