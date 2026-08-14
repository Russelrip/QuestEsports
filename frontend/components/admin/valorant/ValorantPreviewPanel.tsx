"use client";

import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatRiotId, type RiotId, type SeriesPreview } from "@/lib/valorant";

export default function ValorantPreviewPanel({
  preview,
  loading,
  error,
  anchors,
  winnerLabel,
  onRetry,
}: {
  preview: SeriesPreview | null;
  loading: boolean;
  error: string;
  anchors: { playerA: RiotId; playerB: RiotId } | null;
  winnerLabel: (teamId: string | null) => string;
  onRetry?: () => void;
}) {
  return (
    <Card className="p-5">
      <h3 className="text-lg font-semibold text-white">Preview</h3>

      {error ? (
        <div className="mt-4">
          <ValorantErrorAlert message={error} onRetry={onRetry} />
        </div>
      ) : loading ? (
        <div className="mt-4">
          <ValorantLoadingState />
        </div>
      ) : preview?.valid ? (
        <div className="mt-4 grid gap-3">
          <Badge className="border-emerald-300/20 bg-emerald-400/10 text-emerald-100">
            Ready to finalize
          </Badge>
          <p className="text-sm text-slate-300">
            Maps won: {preview.teamAMapsWon}–{preview.teamBMapsWon}
          </p>
          <p className="text-sm text-slate-300">
            Calculated winner: {winnerLabel(preview.calculatedWinnerId)}
          </p>
          <ul className="grid gap-2">
            {preview.games.map((game) => (
              <li key={game.id} className="rounded-xl border border-white/10 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-white">
                    Game {game.gameNumber}: {game.mapName ?? "Unknown map"}
                  </p>
                  <p className="text-sm text-slate-400">
                    {game.teamARounds}–{game.teamBRounds} · winner:{" "}
                    {winnerLabel(game.winnerTeamId)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {anchors ? (
            <p className="text-xs text-slate-500">
              Anchors: {formatRiotId(anchors.playerA)} vs {formatRiotId(anchors.playerB)}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          <Badge className="border-amber-300/20 bg-amber-400/10 text-amber-100">
            Not ready
          </Badge>
          {preview && preview.errors.length > 0 ? (
            <ul role="list" className="grid gap-1 pl-4 text-sm text-slate-400">
              {preview.errors.map((item) => (
                <li key={item} className="list-disc">
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Card>
  );
}
