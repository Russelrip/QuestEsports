"use client";

import { useState } from "react";
import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useValorantMatches } from "@/hooks/api/useValorant";
import { formatAdminCompactDateTime } from "@/lib/admin";
import type { ValorantMatchSummary } from "@/lib/valorant";

export default function ValorantMatchLibrary({
  onPick,
}: {
  onPick: (match: ValorantMatchSummary) => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const matchesQuery = useValorantMatches(cursor, true);
  const matches = matchesQuery.data?.items ?? [];
  const nextCursor = matchesQuery.data?.nextCursor ?? null;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-white">Match library</h3>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={matchesQuery.loading || !nextCursor}
          onClick={() => {
            if (nextCursor) setCursor(nextCursor);
          }}
        >
          {matchesQuery.loading ? "Loading…" : "Load more"}
        </Button>
      </div>

      {matchesQuery.error ? (
        <ValorantErrorAlert message={matchesQuery.error} onRetry={() => void matchesQuery.refetch()} />
      ) : matchesQuery.loading ? (
        <ValorantLoadingState />
      ) : matches.length === 0 ? (
        <ValorantEmptyState
          title="No imported matches"
          description="Import a match from Discovery first."
        />
      ) : (
        <ul className="mt-4 grid gap-2">
          {matches.map((match) => (
            <li
              key={match.matchId}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-white">{match.mapName}</p>
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
          ))}
        </ul>
      )}
    </Card>
  );
}
