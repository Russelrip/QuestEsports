"use client";

import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useValorantSeriesMatches } from "@/hooks/api/useValorant";
import { formatAdminCompactDateTime } from "@/lib/admin";
import { teamValuesFromSide, type ValorantMatchSummary } from "@/lib/valorant";

export default function ValorantMatchLibrary({
  seriesId,
  teamALabel,
  teamBLabel,
  onPick,
}: {
  seriesId: string;
  teamALabel: string;
  teamBLabel: string;
  onPick: (match: ValorantMatchSummary) => void;
}) {
  const matchesQuery = useValorantSeriesMatches(seriesId, true);
  const matches = matchesQuery.data?.matches ?? [];

  return (
    <Card className="p-5">
      <h3 className="text-lg font-semibold text-white">Relevant matches</h3>
      <p className="text-sm text-slate-400">
        Matches tied to this series&apos; anchor players. Sides are derived from anchors.
      </p>

      {matchesQuery.error ? (
        <div className="mt-4">
          <ValorantErrorAlert message={matchesQuery.error} onRetry={() => void matchesQuery.refetch()} />
        </div>
      ) : matchesQuery.loading ? (
        <div className="mt-4">
          <ValorantLoadingState />
        </div>
      ) : matches.length === 0 ? (
        <div className="mt-4">
          <ValorantEmptyState
            title="No relevant matches"
            description="Import matches from Discovery that include both anchor players."
          />
        </div>
      ) : (
        <ul className="mt-4 grid gap-2">
          {matches.map((match) => {
            const s = teamValuesFromSide(match.anchorASide, match.redScore, match.blueScore);
            return (
              <li
                key={match.matchId}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white">{match.mapName}</p>
                  <p className="text-xs text-slate-300">
                    {teamALabel} vs {teamBLabel}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatAdminCompactDateTime(match.startedAt)}
                  </p>
                </div>
                <p className="whitespace-nowrap text-sm text-slate-300">
                  {teamALabel} {s?.teamA ?? "–"}–{s?.teamB ?? "–"} {teamBLabel}
                </p>
                {match.winningSide && match.anchorASide ? (
                  <Badge>
                    {match.winningSide === match.anchorASide
                      ? `${teamALabel} win`
                      : `${teamBLabel} win`}
                  </Badge>
                ) : (
                  <Badge className="text-slate-500">No winner</Badge>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onPick(match)}
                >
                  Attach
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
