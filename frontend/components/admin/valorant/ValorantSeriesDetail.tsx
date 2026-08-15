"use client";

import { useState } from "react";
import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantFinalizeForm from "@/components/admin/valorant/ValorantFinalizeForm";
import ValorantGameRow from "@/components/admin/valorant/ValorantGameRow";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import ValorantOperationBanner from "@/components/admin/valorant/ValorantOperationBanner";
import ValorantPreviewPanel from "@/components/admin/valorant/ValorantPreviewPanel";
import ValorantReorderControl from "@/components/admin/valorant/ValorantReorderControl";
import ValorantStatusBadge from "@/components/admin/valorant/ValorantStatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useValorantPreview, useValorantSeriesDetail } from "@/hooks/api/useValorant";
import { useToastStore } from "@/hooks/useToastStore";
import { formatAdminCompactDateTime } from "@/lib/admin";
import {
  nextGameNumber,
  ratingModeLabel,
  type FinalizeResult,
  type MatchCandidate,
  type QuestValorantSeries,
} from "@/lib/valorant";
import {
  attachValorantGame,
  deleteValorantSeries,
  discoverValorant,
  importValorantMatch,
  removeValorantGame,
  setValorantGameOrder,
} from "@/lib/valorant-api";

const teamLabel = (series: QuestValorantSeries, side: "A" | "B") => {
  const savedTeam = side === "A" ? series.bindingA.savedTeam : series.bindingB.savedTeam;
  if (!savedTeam) return "—";
  return savedTeam.teamTag ? `${savedTeam.name} (${savedTeam.teamTag})` : savedTeam.name;
};

// Winning score is highlighted so "who won" is visible at a glance; the
// highlighted score IS the indicator, so no side labels are used.
const scoreHighlightClasses = (red: number | null, blue: number | null) => {
  if (red !== null && blue !== null && red !== blue) {
    return red > blue
      ? { red: "font-semibold text-emerald-300", blue: "text-slate-500" }
      : { red: "text-slate-500", blue: "font-semibold text-emerald-300" };
  }
  return { red: "", blue: "" };
};

export default function ValorantSeriesDetail({
  seriesId,
  onBack,
}: {
  seriesId: string;
  onBack?: () => void;
}) {
  const showToast = useToastStore((state) => state.showToast);

  const detailQuery = useValorantSeriesDetail(seriesId);
  const series = detailQuery.data?.series ?? null;
  const previewQuery = useValorantPreview(seriesId, Boolean(series?.valorantSeriesUuid));
  const preview = previewQuery.data?.preview ?? null;

  const [mutationBusy, setMutationBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverCandidates, setDiscoverCandidates] = useState<MatchCandidate[]>([]);
  const [attachingCandidateId, setAttachingCandidateId] = useState<string | null>(null);
  const [removingGameId, setRemovingGameId] = useState<string | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [finalizeResult, setFinalizeResult] = useState<FinalizeResult | null>(null);

  if (detailQuery.loading) {
    return (
      <div className="grid min-w-0 gap-4 sm:gap-6">
        <ValorantLoadingState />
      </div>
    );
  }

  if (detailQuery.error) {
    return (
      <div className="grid min-w-0 gap-4 sm:gap-6">
        <ValorantErrorAlert message={detailQuery.error} onRetry={() => void detailQuery.refetch()} />
      </div>
    );
  }

  if (!series) {
    return (
      <div className="grid min-w-0 gap-4 sm:gap-6">
        <ValorantEmptyState
          title="Series not found"
          description="The draft series could not be loaded."
        />
      </div>
    );
  }

  const isDraft = series.status === "draft";
  const games = [...series.games].sort((a, b) => a.gameNumber - b.gameNumber);
  const teamALabel = teamLabel(series, "A");
  const teamBLabel = teamLabel(series, "B");
  const anchors =
    series.anchorPlayerAName && series.anchorPlayerBName
      ? {
          playerA: { name: series.anchorPlayerAName, tag: series.anchorPlayerATag ?? "" },
          playerB: { name: series.anchorPlayerBName, tag: series.anchorPlayerBTag ?? "" },
        }
      : null;
  const showRecheck =
    series.status === "reconciliation_required" ||
    series.lastOperation?.status === "reconciliation_required";

  const winnerLabel = (teamId: string | null): string => {
    if (!teamId) return "—";
    if (teamId === series.bindingA.valorantTeamUuid) return teamALabel;
    if (teamId === series.bindingB.valorantTeamUuid) return teamBLabel;
    return teamId;
  };

  const handleReorder = async (order: Array<{ gameId: string; gameNumber: number }>) => {
    setMutationBusy(true);
    try {
      await setValorantGameOrder(seriesId, order);
      await detailQuery.refetch();
      await previewQuery.refetch();
      showToast({ title: "Map order saved", tone: "success" });
    } catch (reorderError) {
      const message =
        reorderError instanceof Error ? reorderError.message : "Could not save the map order.";
      showToast({ title: message, tone: "error" });
    } finally {
      setMutationBusy(false);
    }
  };

  const handleRemoveGame = async (gameId: string) => {
    setRemovingGameId(gameId);
    setMutationBusy(true);
    try {
      await removeValorantGame(seriesId, gameId);
      await detailQuery.refetch();
      await previewQuery.refetch();
      showToast({ title: "Game removed", tone: "success" });
    } catch (removeError) {
      const message =
        removeError instanceof Error ? removeError.message : "Could not remove the game.";
      showToast({ title: message, tone: "error" });
    } finally {
      setRemovingGameId(null);
      setMutationBusy(false);
    }
  };

  const handleDiscover = async () => {
    if (!anchors) return;
    setDiscovering(true);
    setDiscoverError(null);
    setDiscoverCandidates([]);
    try {
      const response = await discoverValorant({
        playerA: anchors.playerA,
        playerB: anchors.playerB,
        maxPages: 5,
      });
      setDiscoverCandidates(response.candidates);
    } catch (discoverError) {
      const message =
        discoverError instanceof Error ? discoverError.message : "Discovery failed.";
      setDiscoverError(message);
      showToast({ title: message, tone: "error" });
    } finally {
      setDiscovering(false);
    }
  };

  const handleAttachCandidate = async (candidate: MatchCandidate) => {
    if (mutationBusy) return;
    setAttachingCandidateId(candidate.henrikMatchId);
    setMutationBusy(true);
    try {
      let matchId = candidate.matchId ?? null;
      if (!matchId) {
        const { match } = await importValorantMatch(candidate.henrikMatchId, candidate.affinity);
        matchId = match.matchId;
      }
      if (!matchId) {
        throw new Error("This match has no VALORANT match ID to attach.");
      }
      const gameNumber = nextGameNumber(
        games.map((game) => game.gameNumber),
        series.format
      );
      if (gameNumber === null) {
        throw new Error("The series is full — no free game numbers remain.");
      }
      await attachValorantGame(seriesId, { gameNumber, matchId });
      setDiscoverCandidates((current) =>
        current.filter((item) => item.henrikMatchId !== candidate.henrikMatchId)
      );
      await detailQuery.refetch();
      await previewQuery.refetch();
      showToast({ title: "Game attached", tone: "success" });
    } catch (attachError) {
      const message =
        attachError instanceof Error ? attachError.message : "Could not attach the match.";
      showToast({ title: message, tone: "error" });
    } finally {
      setAttachingCandidateId(null);
      setMutationBusy(false);
    }
  };

  const handleDeleteSeries = async () => {
    setMutationBusy(true);
    try {
      await deleteValorantSeries(seriesId);
      showToast({ title: "Draft series deleted", tone: "success" });
      onBack?.();
    } catch (deleteError) {
      setDeleteConfirming(false);
      const message =
        deleteError instanceof Error ? deleteError.message : "Could not delete the draft series.";
      showToast({ title: message, tone: "error" });
    } finally {
      setMutationBusy(false);
    }
  };

  const handleFinalized = async (result: FinalizeResult) => {
    setFinalizeResult(result);
    showToast({ title: "Series finalized", tone: "success" });
    await detailQuery.refetch();
    await previewQuery.refetch();
  };

  const handleAlreadyFinalized = () => {
    void detailQuery.refetch();
    void previewQuery.refetch();
  };

  return (
    <div className="grid min-w-0 gap-4 sm:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{series.format.toUpperCase()} series</h3>
          <p className="text-sm text-slate-400">
            {teamALabel} vs {teamBLabel} · {formatAdminCompactDateTime(series.playedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ValorantStatusBadge status={series.status} kind="series" />
          {isDraft ? (
            <Button
              type="button"
              variant="danger"
              disabled={mutationBusy}
              onClick={() => {
                if (!deleteConfirming) {
                  setDeleteConfirming(true);
                  return;
                }
                setDeleteConfirming(false);
                void handleDeleteSeries();
              }}
            >
              {deleteConfirming ? "Confirm delete draft series?" : "Delete draft series"}
            </Button>
          ) : null}
          {showRecheck ? (
            <Button
              type="button"
              variant="secondary"
              disabled={detailQuery.loading || previewQuery.loading}
              onClick={() => {
                void detailQuery.refetch();
                void previewQuery.refetch();
              }}
            >
              Re-check status
            </Button>
          ) : null}
          {onBack ? (
            <Button type="button" variant="ghost" onClick={onBack}>
              Back to series
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-w-0 overflow-x-auto">
        {isDraft && deleteConfirming ? (
          <Card className="px-5 py-4 text-sm text-red-200">
            Delete this draft series? Finalized history is never affected.
          </Card>
        ) : null}

        <ValorantOperationBanner operation={series.lastOperation} inFlight={mutationBusy} />

        {showRecheck ? (
          <p role="status" className="text-xs text-slate-500">
            Re-check status only reads the current state — it never retries automatically.
          </p>
        ) : null}

        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-lg font-semibold text-white">Games</h4>
            {isDraft && anchors ? (
              <Button
                type="button"
                size="sm"
                onClick={() => void handleDiscover()}
                disabled={discovering}
              >
                {discovering ? "Discovering…" : "Discover matches"}
              </Button>
            ) : null}
          </div>

          {isDraft && games.length > 1 ? (
            <ValorantReorderControl games={games} onReorder={handleReorder} />
          ) : null}

          {games.length === 0 ? (
            <ValorantEmptyState
              title="No games attached"
              description="Attach imported matches to this series."
            />
          ) : (
            <div className="grid gap-3">
              {games.map((game) => (
                <ValorantGameRow
                  key={game.id}
                  game={game}
                  teamALabel={teamALabel}
                  teamBLabel={teamBLabel}
                  removable={isDraft}
                  onRemove={() => void handleRemoveGame(game.id)}
                  removing={removingGameId === game.id}
                />
              ))}
            </div>
          )}

          {isDraft && anchors ? (
            discovering ? (
              <ValorantLoadingState />
            ) : discoverError ? (
              <ValorantErrorAlert message={discoverError} onRetry={() => void handleDiscover()} />
            ) : discoverCandidates.length > 0 ? (
              <Card className="border-purple-400/25 bg-purple-400/5 p-5">
                <h4 className="text-sm font-semibold text-white">Discovered matches</h4>
                <p className="mt-1 text-xs text-slate-400">
                  Pick a match to attach as the next game in this series.
                </p>
                <ul className="mt-3 grid gap-2">
                  {discoverCandidates.map((candidate) => {
                    const scoreClasses = scoreHighlightClasses(
                      candidate.redScore,
                      candidate.blueScore,
                    );
                    return (
                      <li
                        key={candidate.henrikMatchId}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-purple-400/20 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-white">
                            {candidate.map ?? "Unknown map"}
                          </p>
                          <p className="text-xs text-slate-400">
                            {formatAdminCompactDateTime(candidate.startedAt)}
                          </p>
                        </div>
                        <p className="whitespace-nowrap font-mono text-sm text-slate-300">
                          <span className={scoreClasses.red}>
                            {candidate.redScore ?? "–"}
                          </span>
                          –
                          <span className={scoreClasses.blue}>
                            {candidate.blueScore ?? "–"}
                          </span>
                        </p>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={attachingCandidateId !== null}
                          onClick={() => void handleAttachCandidate(candidate)}
                        >
                          {attachingCandidateId === candidate.henrikMatchId
                            ? "Attaching…"
                            : "Attach"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ) : (
              <ValorantEmptyState
                title="No shared matches found"
                description="Try again later, or review the anchor players on this series."
              />
            )
          ) : null}
        </section>

        {series.status === "finalized" ? (
          <Card className="p-5">
            <h4 className="text-lg font-semibold text-white">Committed result</h4>
            <div className="mt-3 grid gap-2 text-sm text-slate-300">
              <div>
                <ValorantStatusBadge status={series.status} kind="series" />
              </div>
              <p>Rating mode: {ratingModeLabel(series.ratingMode ?? series.ratingModePreference)}</p>
              <p>Finalized by: {series.finalizedById ?? "—"}</p>
              <p>
                VALORANT series:{" "}
                {series.valorantSeriesUuid
                  ? `${series.valorantSeriesUuid.slice(0, 8)}…`
                  : "—"}
              </p>
              {finalizeResult ? (
                <p>
                  Current ELO — Team A: {finalizeResult.teamACurrentElo} · Team B:{" "}
                  {finalizeResult.teamBCurrentElo}
                </p>
              ) : null}
            </div>
          </Card>
        ) : (
          <>
            <ValorantPreviewPanel
              preview={preview}
              loading={previewQuery.loading}
              error={previewQuery.error}
              anchors={anchors}
              winnerLabel={winnerLabel}
              onRetry={() => void previewQuery.refetch()}
            />
            {isDraft ? (
              <ValorantFinalizeForm
                seriesId={seriesId}
                teamALabel={series.bindingA.savedTeam?.name ?? "Team A"}
                teamBLabel={series.bindingB.savedTeam?.name ?? "Team B"}
                teamAId={series.bindingA.valorantTeamUuid}
                teamBId={series.bindingB.valorantTeamUuid}
                calculatedWinnerId={preview?.calculatedWinnerId ?? null}
                onFinalized={handleFinalized}
                onAlreadyFinalized={handleAlreadyFinalized}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
