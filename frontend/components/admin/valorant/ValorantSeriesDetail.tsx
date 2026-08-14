"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import ValorantAttachGameDialog from "@/components/admin/valorant/ValorantAttachGameDialog";
import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantFinalizeForm from "@/components/admin/valorant/ValorantFinalizeForm";
import ValorantGameRow from "@/components/admin/valorant/ValorantGameRow";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import ValorantMatchLibrary from "@/components/admin/valorant/ValorantMatchLibrary";
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
  ratingModeLabel,
  type FinalizeResult,
  type QuestValorantSeries,
  type ValorantMatchSummary,
} from "@/lib/valorant";
import {
  deleteValorantSeries,
  removeValorantGame,
  setValorantGameOrder,
} from "@/lib/valorant-api";

const teamLabel = (series: QuestValorantSeries, side: "A" | "B") => {
  const savedTeam = side === "A" ? series.bindingA.savedTeam : series.bindingB.savedTeam;
  if (!savedTeam) return "—";
  return savedTeam.teamTag ? `${savedTeam.name} (${savedTeam.teamTag})` : savedTeam.name;
};

export default function ValorantSeriesDetail() {
  const params = useParams<{ id: string }>();
  const seriesId = params?.id ?? "";
  const router = useRouter();
  const showToast = useToastStore((state) => state.showToast);

  const detailQuery = useValorantSeriesDetail(seriesId);
  const series = detailQuery.data?.series ?? null;
  const previewQuery = useValorantPreview(seriesId, Boolean(series?.valorantSeriesUuid));
  const preview = previewQuery.data?.preview ?? null;

  const [mutationBusy, setMutationBusy] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pickedMatch, setPickedMatch] = useState<ValorantMatchSummary | null>(null);
  const [removingGameId, setRemovingGameId] = useState<string | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [finalizeResult, setFinalizeResult] = useState<FinalizeResult | null>(null);

  if (detailQuery.loading) {
    return (
      <AdminShell title="VALORANT Series" description="Loading the series detail.">
        <ValorantLoadingState />
      </AdminShell>
    );
  }

  if (detailQuery.error) {
    return (
      <AdminShell title="VALORANT Series" description="Loading the series detail.">
        <ValorantErrorAlert message={detailQuery.error} onRetry={() => void detailQuery.refetch()} />
      </AdminShell>
    );
  }

  if (!series) {
    return (
      <AdminShell title="VALORANT Series" description="Loading the series detail.">
        <ValorantEmptyState
          title="Series not found"
          description="The draft series could not be loaded."
        />
      </AdminShell>
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

  const handleAttached = async () => {
    setMutationBusy(true);
    try {
      await detailQuery.refetch();
      await previewQuery.refetch();
      showToast({ title: "Game attached", tone: "success" });
    } finally {
      setMutationBusy(false);
    }
  };

  const handleDeleteSeries = async () => {
    setMutationBusy(true);
    try {
      await deleteValorantSeries(seriesId);
      showToast({ title: "Draft series deleted", tone: "success" });
      router.push("/admin/valorant/series");
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
    <AdminShell
      title={`${series.format.toUpperCase()} series`}
      description={`${teamALabel} vs ${teamBLabel} · ${formatAdminCompactDateTime(series.playedAt)}`}
      actions={
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
        </div>
      }
    >
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
          <h3 className="text-lg font-semibold text-white">Games</h3>
          {isDraft ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setLibraryOpen((open) => !open)}
            >
              {libraryOpen ? "Close match library" : "Attach map"}
            </Button>
          ) : null}
        </div>

        {isDraft && games.length > 1 ? (
          <ValorantReorderControl games={games} onReorder={handleReorder} />
        ) : null}

        {libraryOpen ? (
          <ValorantMatchLibrary
            onPick={(match) => {
              setPickedMatch(match);
            }}
          />
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
      </section>

      {series.status === "finalized" ? (
        <Card className="p-5">
          <h3 className="text-lg font-semibold text-white">Committed result</h3>
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

      {pickedMatch ? (
        <ValorantAttachGameDialog
          seriesId={seriesId}
          match={pickedMatch}
          existingNumbers={games.map((game) => game.gameNumber)}
          format={series.format}
          onClose={() => setPickedMatch(null)}
          onAttached={handleAttached}
        />
      ) : null}
    </AdminShell>
  );
}
