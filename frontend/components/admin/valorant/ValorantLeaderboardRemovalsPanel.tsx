"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useValorantLeaderboardRemovals } from "@/hooks/api/useValorant";
import { useToastStore } from "@/hooks/useToastStore";
import { formatAdminCompactDateTime } from "@/lib/admin";
import { cn } from "@/lib/utils";
import {
  leaderboardRemovalBlocker,
  type ValorantLeaderboardActor,
  type ValorantLeaderboardRemovedPlayer,
} from "@/lib/valorant";
import { restoreValorantLeaderboardRemoval } from "@/lib/valorant-api";

const REASON_MAX_LENGTH = 500;

const actorName = (actor: ValorantLeaderboardActor | null) =>
  actor ? (actor.username ? `@${actor.username}` : "a deleted account") : "unknown";

export default function ValorantLeaderboardRemovalsPanel({
  refreshToken,
  onRestored,
}: {
  // Bumped by the players table after a removal, so the new removal shows here.
  refreshToken: number;
  onRestored: () => void;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [page, setPage] = useState(1);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const removalsQuery = useValorantLeaderboardRemovals("", page);
  const { refetch } = removalsQuery;
  const entries = removalsQuery.data?.entries ?? [];
  const totalPages = removalsQuery.data?.totalPages ?? 1;
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // A new removal lands on the first page.
    setPage(1);
    void refetch();
  }, [refreshToken, refetch]);

  const closeRestore = () => {
    setRestoringId(null);
    setReason("");
  };

  const handleRestore = async (entry: ValorantLeaderboardRemovedPlayer) => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await restoreValorantLeaderboardRemoval(entry.removalId, trimmed);
      showToast({ title: `${entry.name}#${entry.tag} restored to the leaderboard`, tone: "success" });
      closeRestore();
      onRestored();
    } catch (restoreError) {
      const message = restoreError instanceof Error ? restoreError.message : "Could not restore this player.";
      showToast({ title: message, tone: "error" });
    } finally {
      setSubmitting(false);
      // Refused or not, what is restorable may have changed.
      void refetch();
    }
  };

  return (
    <div className="grid min-w-0 gap-4">
      <div>
        <h3 className="text-lg font-semibold text-white">Removed players</h3>
        <p className="text-sm text-slate-400">
          Players removed from the leaderboard, newest first. Restoring puts a player back exactly as they were; the rank
          updater and Discord bot pick them up again on their next pass. Removals made before restoring was added were not
          kept and do not appear here.
        </p>
      </div>

      {removalsQuery.error ? (
        <ValorantErrorAlert message={removalsQuery.error} onRetry={() => void refetch()} />
      ) : removalsQuery.loading && !removalsQuery.data ? (
        <ValorantLoadingState />
      ) : entries.length === 0 ? (
        <ValorantEmptyState
          title="No removed players"
          description="Players you remove from the leaderboard appear here, where a removal can be undone."
        />
      ) : (
        <>
          <Card className={cn("min-w-0 overflow-hidden transition-opacity", removalsQuery.loading && "opacity-60")}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    <th scope="col" className="px-4 py-3">Player</th>
                    <th scope="col" className="px-4 py-3">Rank when removed</th>
                    <th scope="col" className="px-4 py-3">Removed</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const confirming = restoringId === entry.removalId;
                    const blocker = leaderboardRemovalBlocker(entry);
                    return (
                      <Fragment key={entry.removalId}>
                        <tr className={cn("border-b border-white/5", confirming && "bg-emerald-500/5")}>
                          <td className="px-4 py-4">
                            <p className="font-semibold text-white">{entry.name}#{entry.tag}</p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {entry.discordUsername ? `@${entry.discordUsername}` : "No Discord linked"}
                            </p>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-slate-300">
                            {entry.currentTier ?? "—"}
                            {entry.elo !== null ? <span className="ml-2 text-xs text-slate-500">{entry.elo} ELO</span> : null}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <p className="text-slate-300">{formatAdminCompactDateTime(entry.removedAt)}</p>
                            <p className="mt-0.5 text-xs text-slate-500">by {actorName(entry.removedBy)}</p>
                          </td>
                          <td className="px-4 py-4">
                            {entry.restoredAt ? (
                              <>
                                <p className="text-emerald-200">Restored</p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {formatAdminCompactDateTime(entry.restoredAt)} by {actorName(entry.restoredBy)}
                                </p>
                              </>
                            ) : blocker ? (
                              <p className="text-slate-400">{blocker}</p>
                            ) : (
                              <p className="text-slate-300">Can be restored</p>
                            )}
                          </td>
                          <td className="px-4 py-4 text-right">
                            {confirming || blocker ? null : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={submitting}
                                onClick={() => {
                                  setRestoringId(entry.removalId);
                                  setReason("");
                                }}
                              >
                                Restore
                              </Button>
                            )}
                          </td>
                        </tr>
                        {confirming ? (
                          <tr className="border-b border-white/5 bg-emerald-500/5">
                            <td colSpan={5} className="px-4 pb-5">
                              <form
                                className="grid gap-3"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void handleRestore(entry);
                                }}
                              >
                                <div className="text-sm text-slate-300">
                                  <p className="font-semibold text-white">
                                    Restore {entry.name}#{entry.tag} to the leaderboard?
                                  </p>
                                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-400">
                                    <li>Their registration comes back exactly as it was, with the same Riot account and Discord.</li>
                                    <li>The rank updater refreshes them within the hour, and the Discord bot restores their rank roles on its next pass.</li>
                                    <li>If they have registered again, or their Discord is now registered to someone else, the restore is refused.</li>
                                  </ul>
                                </div>
                                <label className="grid gap-1.5 text-sm text-slate-300">
                                  Reason (kept in the audit log)
                                  <Textarea
                                    value={reason}
                                    onChange={(event) => setReason(event.target.value)}
                                    maxLength={REASON_MAX_LENGTH}
                                    required
                                    autoFocus
                                    className="min-h-20"
                                    placeholder="e.g. Removed by mistake; the request was for a different player."
                                  />
                                </label>
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={closeRestore}>
                                    Cancel
                                  </Button>
                                  <Button type="submit" size="sm" disabled={submitting || !reason.trim()}>
                                    {submitting ? "Restoring…" : "Restore player"}
                                  </Button>
                                </div>
                              </form>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          {totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={page <= 1 || removalsQuery.loading}
                onClick={() => {
                  closeRestore();
                  setPage(page - 1);
                }}
              >
                Previous
              </Button>
              <span>
                Page {page} of {totalPages}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={page >= totalPages || removalsQuery.loading}
                onClick={() => {
                  closeRestore();
                  setPage(page + 1);
                }}
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
