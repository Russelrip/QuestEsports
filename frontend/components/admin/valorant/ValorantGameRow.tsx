"use client";

import { useState } from "react";
import ValorantSideBadges from "@/components/admin/valorant/ValorantSideBadges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { SeriesGame } from "@/lib/valorant";

export default function ValorantGameRow({
  game,
  teamALabel,
  teamBLabel,
  removable,
  onRemove,
  removing,
}: {
  game: SeriesGame;
  teamALabel: string;
  teamBLabel: string;
  removable: boolean;
  onRemove: () => void;
  removing: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  const handleRemoveClick = () => {
    if (removing) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onRemove();
  };

  return (
    <Card className="flex flex-wrap items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h4 className="font-semibold text-white">Game {game.gameNumber}</h4>
          <span className="text-sm text-slate-300">{game.mapName ?? "Unknown map"}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {teamALabel} vs {teamBLabel}
        </p>
        <p className="mt-1 truncate font-mono text-xs text-slate-400" title={game.matchId}>
          {game.matchId.slice(0, 8)}…
        </p>
      </div>
      <ValorantSideBadges teamASide={game.teamASide} teamBSide={game.teamBSide} />
      {removable ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={removing}
          onClick={handleRemoveClick}
        >
          {removing ? "Removing…" : confirming ? "Confirm remove?" : "Remove"}
        </Button>
      ) : null}
    </Card>
  );
}
