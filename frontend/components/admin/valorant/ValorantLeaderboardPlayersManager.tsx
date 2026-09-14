"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLeaderboardRemovalsPanel from "@/components/admin/valorant/ValorantLeaderboardRemovalsPanel";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import LeaderboardSearchForm, {
  Highlight,
  LEADERBOARD_SEARCH_DEBOUNCE_MS,
  effectiveLeaderboardQuery,
} from "@/components/valorant/LeaderboardSearchForm";
import { useValorantLeaderboardRegistrations } from "@/hooks/api/useValorant";
import { useToastStore } from "@/hooks/useToastStore";
import { formatAdminCompactDateTime } from "@/lib/admin";
import { formatSriLankaDate } from "@/lib/date-time";
import { cn } from "@/lib/utils";
import type { ValorantLeaderboardRegistration } from "@/lib/valorant";
import {
  removeValorantLeaderboardRegistration,
  restoreValorantLeaderboardRemoval,
} from "@/lib/valorant-api";

const REASON_MAX_LENGTH = 500;
// Recorded as the restore reason when an admin undoes a removal they just made.
export const UNDO_REMOVAL_REASON = "Undone straight after removing: removed by mistake.";

type LastRemoval = { removalId: string; label: string };
// The updater refreshes every player roughly hourly, so a row untouched for a
// day is one it keeps failing on — usually the account a removal is for.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const isStale = (entry: ValorantLeaderboardRegistration) =>
  Date.now() - new Date(entry.updatedAt).getTime() > STALE_AFTER_MS;

export default function ValorantLeaderboardPlayersManager() {
  const showToast = useToastStore((state) => state.showToast);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [removingPuuid, setRemovingPuuid] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastRemoval, setLastRemoval] = useState<LastRemoval | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [removalsVersion, setRemovalsVersion] = useState(0);

  const registrationsQuery = useValorantLeaderboardRegistrations(query, page);
  // A newer search is loading while the previous results are still shown.
  const searching = registrationsQuery.loading && Boolean(registrationsQuery.data);
  const entries = registrationsQuery.data?.entries ?? [];
  const total = registrationsQuery.data?.total ?? 0;
  const totalPages = registrationsQuery.data?.totalPages ?? 1;

  const closeRemoval = () => {
    setRemovingPuuid(null);
    setReason("");
  };

  // Same behaviour as the public leaderboard search: results follow the input
  // after a short pause, from two characters, a leading @ ignored.
  const applyQuery = (next: string) => {
    if (next === query) return;
    closeRemoval();
    setPage(1);
    setQuery(next);
  };

  useEffect(() => {
    const next = effectiveLeaderboardQuery(search);
    if (next === query) return;
    const timer = setTimeout(() => {
      setRemovingPuuid(null);
      setReason("");
      setPage(1);
      setQuery(next);
    }, LEADERBOARD_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, query]);

  // Submitting flushes the pending debounce instead of waiting it out.
  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyQuery(effectiveLeaderboardQuery(search));
  };

  const clearSearch = () => {
    setSearch("");
    applyQuery("");
  };

  const handleRemove = async (entry: ValorantLeaderboardRegistration) => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const result = await removeValorantLeaderboardRegistration(entry.puuid, trimmed);
      const label = `${entry.name}#${entry.tag}`;
      showToast({ title: `${label} removed from the leaderboard`, tone: "success" });
      setLastRemoval(result.removalId ? { removalId: result.removalId, label } : null);
      setRemovalsVersion((version) => version + 1);
      closeRemoval();
      if (entries.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        await registrationsQuery.refetch();
      }
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : "Could not remove this player.";
      showToast({ title: message, tone: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const undoLastRemoval = async () => {
    if (!lastRemoval) return;
    setUndoing(true);
    try {
      await restoreValorantLeaderboardRemoval(lastRemoval.removalId, UNDO_REMOVAL_REASON);
      showToast({ title: `${lastRemoval.label} restored to the leaderboard`, tone: "success" });
      setLastRemoval(null);
      await registrationsQuery.refetch();
    } catch (undoError) {
      const message = undoError instanceof Error ? undoError.message : "Could not undo this removal.";
      showToast({ title: message, tone: "error" });
    } finally {
      setUndoing(false);
      setRemovalsVersion((version) => version + 1);
    }
  };

  return (
    <div className="grid min-w-0 gap-4 sm:gap-6">
      <div>
        <h3 className="text-lg font-semibold text-white">Leaderboard Players</h3>
        <p className="text-sm text-slate-400">
          Every player registered for the public VALORANT leaderboard, including the ones it currently hides. Without a
          search, players the rank updater has not refreshed for longest are listed first; with one, the best matches are.
        </p>
      </div>

      {lastRemoval ? (
        <div
          role="status"
          className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300"
        >
          <p className="min-w-0 break-words">
            <span className="font-semibold text-white">{lastRemoval.label}</span> was removed from the leaderboard.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={undoing} onClick={() => void undoLastRemoval()}>
              {undoing ? "Undoing…" : "Undo"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={undoing} onClick={() => setLastRemoval(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <LeaderboardSearchForm
        search={search}
        setSearch={setSearch}
        onSubmit={handleSearch}
        onClear={clearSearch}
        busy={searching}
        label="Search by Discord username, Riot ID or PUUID"
        hint="Partial matches work — try a Discord name, a Riot name, a tag, a full name#tag, or a PUUID."
        hintId="admin-leaderboard-search-hint"
      />

      {registrationsQuery.error ? (
        <ValorantErrorAlert message={registrationsQuery.error} onRetry={() => void registrationsQuery.refetch()} />
      ) : registrationsQuery.loading && !registrationsQuery.data ? (
        <ValorantLoadingState />
      ) : entries.length === 0 ? (
        <ValorantEmptyState
          title={query ? "No players match" : "No registered players"}
          description={
            query
              ? `No registered player matches “${query}”. Searches cover Discord usernames, Riot IDs and PUUIDs, including partial matches — check the spelling.`
              : "Players appear here once they register for the leaderboard."
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-400" aria-live="polite">
              {total} {total === 1 ? "player" : "players"}
              {query ? (
                <>
                  {" "}matching <span className="text-slate-200">&ldquo;{query}&rdquo;</span>
                </>
              ) : " registered"}
            </p>
            {query ? (
              <Button type="button" variant="ghost" size="sm" onClick={clearSearch}>
                Show all players
              </Button>
            ) : null}
          </div>
          <Card className={cn("min-w-0 overflow-hidden transition-opacity", searching && "opacity-60")}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    <th scope="col" className="px-4 py-3">Player</th>
                    <th scope="col" className="px-4 py-3">Rank</th>
                    <th scope="col" className="px-4 py-3">Last match</th>
                    <th scope="col" className="px-4 py-3">Last refreshed</th>
                    <th scope="col" className="px-4 py-3">Board</th>
                    <th scope="col" className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const confirming = removingPuuid === entry.puuid;
                    const stale = isStale(entry);
                    return (
                      <Fragment key={entry.puuid}>
                        <tr className={cn("border-b border-white/5", confirming && "bg-red-500/5")}>
                          <td className="px-4 py-4">
                            <p className="font-semibold text-white">
                              <Highlight text={`${entry.name}#${entry.tag}`} term={query} />
                            </p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {entry.discordUsername ? (
                                <>@<Highlight text={entry.discordUsername} term={query} /></>
                              ) : "No Discord linked"}
                            </p>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-slate-300">
                            {entry.currentTier ?? "—"}
                            {entry.elo !== null ? <span className="ml-2 text-xs text-slate-500">{entry.elo} ELO</span> : null}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-slate-300">
                            {entry.lastPlayed ? formatSriLankaDate(entry.lastPlayed) : "None recorded"}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <p className={stale ? "text-amber-300" : "text-slate-300"}>
                              {formatAdminCompactDateTime(entry.updatedAt)}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {stale ? "Updater is not refreshing this player" : entry.updateSource ?? "—"}
                            </p>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2.5 py-0.5 text-xs",
                                entry.onLeaderboard
                                  ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                                  : "border-white/10 bg-white/5 text-slate-400"
                              )}
                            >
                              {entry.onLeaderboard ? "Listed" : "Hidden"}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            {confirming ? null : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={submitting}
                                onClick={() => {
                                  setRemovingPuuid(entry.puuid);
                                  setReason("");
                                }}
                              >
                                Remove
                              </Button>
                            )}
                          </td>
                        </tr>
                        {confirming ? (
                          <tr className="border-b border-white/5 bg-red-500/5">
                            <td colSpan={6} className="px-4 pb-5">
                              <form
                                className="grid gap-3"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void handleRemove(entry);
                                }}
                              >
                                <div className="text-sm text-slate-300">
                                  <p className="font-semibold text-white">
                                    Remove {entry.name}#{entry.tag} from the leaderboard?
                                  </p>
                                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-400">
                                    <li>They disappear from the public leaderboard and the rank updater stops refreshing them.</li>
                                    <li>
                                      If they are in the Quest Discord, the bot drops their rank roles and marks them Unverified on
                                      its next pass, unless they have the Manual role.
                                    </li>
                                    <li>The rank shown on their Quest profile is cleared. Their linked game account stays.</li>
                                    <li>They can register again at any time, and you can restore them from Removed players below.</li>
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
                                    placeholder="e.g. Account no longer exists; the updater has failed on it since the migration."
                                  />
                                </label>
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={closeRemoval}>
                                    Cancel
                                  </Button>
                                  <Button type="submit" variant="danger" size="sm" disabled={submitting || !reason.trim()}>
                                    {submitting ? "Removing…" : "Remove player"}
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
            <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={page <= 1 || registrationsQuery.loading}
                onClick={() => {
                  closeRemoval();
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
                disabled={page >= totalPages || registrationsQuery.loading}
                onClick={() => {
                  closeRemoval();
                  setPage(page + 1);
                }}
              >
                Next
              </Button>
            </div>
          ) : null}
        </>
      )}

      <ValorantLeaderboardRemovalsPanel
        refreshToken={removalsVersion}
        onRestored={() => {
          setLastRemoval(null);
          void registrationsQuery.refetch();
        }}
      />
    </div>
  );
}
