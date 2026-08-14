"use client";

import { useState } from "react";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import { useDialogFocus } from "@/components/admin/valorant/useDialogFocus";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatAdminCompactDateTime } from "@/lib/admin";
import {
  mapsForFormat,
  nextGameNumber,
  type RiotId,
  type ValorantFormat,
  type ValorantMatchSummary,
  type ValorantSide,
} from "@/lib/valorant";
import { attachValorantGame } from "@/lib/valorant-api";

function oppositeSide(side: ValorantSide): ValorantSide {
  return side === "red" ? "blue" : "red";
}

export default function ValorantAttachGameDialog({
  seriesId,
  match,
  existingNumbers,
  format,
  anchors,
  onClose,
  onAttached,
}: {
  seriesId: string;
  match: ValorantMatchSummary | null;
  existingNumbers: number[];
  format: ValorantFormat;
  anchors: { playerA: RiotId; playerB: RiotId } | null;
  onClose: () => void;
  onAttached: () => Promise<void>;
}) {
  const [gameNumber, setGameNumber] = useState<number>(() => nextGameNumber(existingNumbers, format) ?? 1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useDialogFocus({ onClose });

  if (match === null) return null;

  const anchorASide = match.anchorASide ?? null;
  const canAttach = anchorASide !== null;

  const handleAttach = async () => {
    setSubmitting(true);
    setError("");
    try {
      await attachValorantGame(seriesId, { gameNumber, matchId: match.matchId });
      await onAttached();
      onClose();
    } catch (attachError) {
      const message =
        attachError instanceof Error ? attachError.message : "Could not attach the match.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Attach match to series"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-10"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-xl p-5 sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white">Attach match</h3>
        <div className="mt-3 rounded-xl border border-white/10 px-4 py-3">
          <p className="font-medium text-white">{match.mapName}</p>
          <p className="mt-1 text-xs text-slate-400">
            {formatAdminCompactDateTime(match.startedAt)} · {match.redScore ?? "–"}–
            {match.blueScore ?? "–"}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-slate-500" title={match.matchId}>
            {match.matchId}
          </p>
        </div>

        <div className="mt-4 grid min-w-0 gap-2">
          <label htmlFor="attach-game-number" className="text-sm font-medium text-slate-300">
            Game number
          </label>
          <Input
            id="attach-game-number"
            type="number"
            aria-label="Game number"
            min={1}
            max={mapsForFormat(format)}
            value={gameNumber}
            onChange={(event) => setGameNumber(Number(event.target.value))}
            disabled={submitting}
          />
        </div>

        <div className="mt-4 grid min-w-0 gap-2">
          <span className="text-sm font-medium text-slate-300">Side mapping</span>
          {canAttach && anchors ? (
            <div className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300">
              <p>
                Team A ({anchors.playerA.name}) = <span className="font-semibold text-white">{anchorASide}</span>
              </p>
              <p className="mt-1">
                Team B ({anchors.playerB.name}) = <span className="font-semibold text-white">{oppositeSide(anchorASide)}</span>
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 px-4 py-3 text-sm text-amber-100">
              Sides couldn&apos;t be determined for this match.
            </div>
          )}
          <p className="text-xs text-slate-500">
            The platform derives sides from the series anchors — scores are never re-entered.
          </p>
        </div>

        {error ? <div className="mt-4"><ValorantErrorAlert message={error} /></div> : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="button" onClick={handleAttach} disabled={submitting || !canAttach}>
            {submitting ? "Attaching…" : "Attach map"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
