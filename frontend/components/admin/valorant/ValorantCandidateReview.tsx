"use client";

import { useEffect, useState } from "react";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatAdminCompactDateTime } from "@/lib/admin";
import { formatRiotId, type MatchCandidate, type MatchDetail, type ResolvedPlayer } from "@/lib/valorant";
import { fetchValorantMatchByHenrikId, importValorantMatch } from "@/lib/valorant-api";

function findSideForPlayer(detail: MatchDetail, player: ResolvedPlayer): "red" | "blue" | null {
  const normalize = (name: string, tag: string) => `${name.trim().toLowerCase()}#${tag.trim().toLowerCase()}`;
  const key = normalize(player.name, player.tag);
  const onRed = detail.players.some((p) => p.side === "red" && normalize(p.name, p.tag) === key);
  const onBlue = detail.players.some((p) => p.side === "blue" && normalize(p.name, p.tag) === key);
  if (onRed && !onBlue) return "red";
  if (onBlue && !onRed) return "blue";
  return null;
}

function resolveSideOwners(
  detail: MatchDetail,
  players: { a: ResolvedPlayer; b: ResolvedPlayer }
): { red: ResolvedPlayer | null; blue: ResolvedPlayer | null } {
  const aSide = findSideForPlayer(detail, players.a);
  const bSide = findSideForPlayer(detail, players.b);
  return {
    red: aSide === "red" ? players.a : bSide === "red" ? players.b : null,
    blue: aSide === "blue" ? players.a : bSide === "blue" ? players.b : null,
  };
}

export default function ValorantCandidateReview({
  candidate,
  players,
  onClose,
  onImported,
}: {
  candidate: MatchCandidate | null;
  players: { a: ResolvedPlayer; b: ResolvedPlayer } | null;
  onClose: () => void;
  onImported: (detail: MatchDetail, created: boolean) => void;
}) {
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [created, setCreated] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!candidate) return;
    setDetail(null);
    setError(null);
    setImporting(false);
    setLoadingDetail(false);
    if (candidate.alreadyImported) {
      // created=false is informational — the match was already imported before this run.
      setCreated(false);
      setLoadingDetail(true);
      fetchValorantMatchByHenrikId(candidate.henrikMatchId)
        .then(({ match }) => setDetail(match))
        .catch((fetchError) => {
          setError(fetchError instanceof Error ? fetchError.message : "Could not load this match.");
        })
        .finally(() => setLoadingDetail(false));
    }
  }, [candidate]);

  if (!candidate) return null;

  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    setError(null);
    try {
      const { match, created: createdNow } = await importValorantMatch(
        candidate.henrikMatchId,
        candidate.affinity
      );
      setDetail(match);
      setCreated(createdNow);
      onImported(match, createdNow);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Could not import this match.");
    } finally {
      setImporting(false);
    }
  };

  const handleRetry = () => {
    if (candidate.alreadyImported) {
      setError(null);
      setLoadingDetail(true);
      fetchValorantMatchByHenrikId(candidate.henrikMatchId)
        .then(({ match }) => setDetail(match))
        .catch((fetchError) => {
          setError(fetchError instanceof Error ? fetchError.message : "Could not load this match.");
        })
        .finally(() => setLoadingDetail(false));
    } else {
      void handleImport();
    }
  };

  const winningSideLabel =
    detail?.winningSide === "red"
      ? "Winning side: Red"
      : detail?.winningSide === "blue"
        ? "Winning side: Blue"
        : "Winning side: —";

  const sideOwners = detail && players ? resolveSideOwners(detail, players) : null;
  const redOwner = sideOwners?.red ?? null;
  const blueOwner = sideOwners?.blue ?? null;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-white">Review candidate match</h3>
          <p className="mt-1 truncate font-mono text-xs text-slate-500" title={candidate.henrikMatchId}>
            {candidate.henrikMatchId}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {error ? (
        <div className="mt-4">
          <ValorantErrorAlert message={error} onRetry={handleRetry} />
        </div>
      ) : loadingDetail ? (
        <div className="mt-4">
          <ValorantLoadingState />
        </div>
      ) : importing ? (
        <div className="mt-4">
          <ValorantLoadingState />
        </div>
      ) : detail ? (
        <>
          <div className="mt-4">
            {created ? <Badge>Imported</Badge> : <Badge>Already imported</Badge>}
          </div>
          <div className="mt-4 grid gap-1 text-sm text-slate-300">
            <p>
              <span className="text-slate-500">Map:</span> {detail.mapName}
            </p>
            <p>
              <span className="text-slate-500">Started:</span> {formatAdminCompactDateTime(detail.startedAt)}
            </p>
            <p>{winningSideLabel}</p>
            <p>
              <span className="text-slate-500">Score:</span> {detail.redScore ?? 0}–{detail.blueScore ?? 0}
            </p>
          </div>
          {redOwner && blueOwner ? (
            <div className="mt-4 grid gap-1 text-sm text-slate-300">
              <p>
                <span className="text-slate-500">Red —</span> {formatRiotId(redOwner)}
              </p>
              <p>
                <span className="text-slate-500">Blue —</span> {formatRiotId(blueOwner)}
              </p>
            </div>
          ) : null}
          <h4 className="mt-6 text-sm font-semibold text-white">Players</h4>
          <div className="mt-2 overflow-x-auto">
            <table aria-label="Match roster" className="w-full min-w-[520px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  <th scope="col" className="px-3 py-2 font-semibold">Player</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Side</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Agent</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Kills</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Deaths</th>
                </tr>
              </thead>
              <tbody>
                {detail.players.map((player) => (
                  <tr key={player.puuid} className="border-b border-white/5 text-slate-300">
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatRiotId({ name: player.name, tag: player.tag })}
                    </td>
                    <td className="px-3 py-2">{player.side === "red" ? "Red" : "Blue"}</td>
                    <td className="px-3 py-2">{player.agentName ?? "—"}</td>
                    <td className="px-3 py-2">{player.kills ?? 0}</td>
                    <td className="px-3 py-2">{player.deaths ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Import another match by closing this dialog and picking a different candidate.
          </p>
        </>
      ) : (
        <>
          <div className="mt-4 grid gap-1 text-sm text-slate-300">
            <p>
              <span className="text-slate-500">Map:</span> {candidate.map ?? "Unknown map"}
            </p>
            <p>
              <span className="text-slate-500">Started:</span> {formatAdminCompactDateTime(candidate.startedAt)}
            </p>
            <p>
              <span className="text-slate-500">Mode / Queue:</span> {candidate.mode ?? "—"} / {candidate.queue ?? "—"}
            </p>
            <p>
              <span className="text-slate-500">Score:</span> {candidate.redScore ?? 0}–{candidate.blueScore ?? 0}
            </p>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Importing this match saves it locally so you can attach it to a Series later.
          </p>
          <Button type="button" className="mt-4" disabled={importing} onClick={() => void handleImport()}>
            Import this match
          </Button>
        </>
      )}
    </Card>
  );
}
