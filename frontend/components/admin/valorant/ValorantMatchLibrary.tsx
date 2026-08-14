"use client";

import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useValorantSeriesMatches } from "@/hooks/api/useValorant";
import { formatAdminCompactDateTime } from "@/lib/admin";
import type { RiotId, ValorantMatchSummary, ValorantSide } from "@/lib/valorant";

function formatSideLabel(
  match: ValorantMatchSummary,
  anchors: { playerA: RiotId; playerB: RiotId }
): string | null {
  if (!match.anchorASide) return null;
  const teamBSide: ValorantSide = match.anchorASide === "red" ? "blue" : "red";
  return `${anchors.playerA.name} (${match.anchorASide}) vs ${anchors.playerB.name} (${teamBSide})`;
}

export default function ValorantMatchLibrary({
  seriesId,
  anchors,
  onPick,
}: {
  seriesId: string;
  anchors: { playerA: RiotId; playerB: RiotId };
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
            const sideLabel = formatSideLabel(match, anchors);
            return (
              <li
                key={match.matchId}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white">{match.mapName}</p>
                  {sideLabel ? <p className="text-xs text-slate-300">{sideLabel}</p> : null}
                  <p className="text-xs text-slate-400">
                    {formatAdminCompactDateTime(match.startedAt)}
                  </p>
                </div>
                <p className="whitespace-nowrap text-sm text-slate-300">
                  {match.redScore ?? "–"}–{match.blueScore ?? "–"}
                </p>
                {match.winningSide ? (
                  <Badge>{match.winningSide === "red" ? "Red win" : "Blue win"}</Badge>
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
