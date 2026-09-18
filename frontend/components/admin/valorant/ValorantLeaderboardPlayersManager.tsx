"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLeaderboardBansPanel from "@/components/admin/valorant/ValorantLeaderboardBansPanel";
import ValorantLeaderboardRemovalsPanel from "@/components/admin/valorant/ValorantLeaderboardRemovalsPanel";
import ValorantLeaderboardServerCheckPanel from "@/components/admin/valorant/ValorantLeaderboardServerCheckPanel";
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
  banValorantLeaderboardRegistration,
  hideValorantLeaderboardRegistration,
  removeValorantLeaderboardRegistration,
  restoreValorantLeaderboardRemoval,
  unhideValorantLeaderboardRegistration,
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

const isHidden = (entry: ValorantLeaderboardRegistration) => Boolean(entry.hiddenAt);

export default function ValorantLeaderboardPlayersManager() {
  const showToast = useToastStore((state) => state.showToast);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [removingPuuid, setRemovingPuuid] = useState<string | null>(null);
  // Hiding and showing again share one inline form, like removal.
  const [hidingPuuid, setHidingPuuid] = useState<string | null>(null);
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [reason, setReason] = useState("");
  const [alsoBan, setAlsoBan] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastRemoval, setLastRemoval] = useState<LastRemoval | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [removalsVersion, setRemovalsVersion] = useState(0);
  const [bansVersion, setBansVersion] = useState(0);
  // Bumped whenever a registration leaves or returns, so the server check follows.
  const [serverChecksVersion, setServerChecksVersion] = useState(0);

  const registrationsQuery = useValorantLeaderboardRegistrations(query, page, hiddenOnly);
  // A newer search is loading while the previous results are still shown.
  const searching = registrationsQuery.loading && Boolean(registrationsQuery.data);
  const entries = registrationsQuery.data?.entries ?? [];
  const total = registrationsQuery.data?.total ?? 0;
  const totalPages = registrationsQuery.data?.totalPages ?? 1;

  const closeRemoval = () => {
    setRemovingPuuid(null);
    setHidingPuuid(null);
    setReason("");
    setAlsoBan(false);
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
      setHidingPuuid(null);
      setReason("");
      setAlsoBan(false);
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
      const label = `${entry.name}#${entry.tag}`;
      if (alsoBan) {
        const result = await banValorantLeaderboardRegistration(entry.puuid, trimmed);
        const alts = result.removed.length - 1;
        showToast({
          title: alts > 0
            ? `${label} banned; ${alts} other ${alts === 1 ? "registration" : "registrations"} on the same accounts removed too`
            : `${label} removed and banned from registering again`,
          tone: "success",
        });
        // Nothing to undo in one click: a restore is refused while the ban stands.
        setLastRemoval(null);
        setBansVersion((version) => version + 1);
      } else {
        const result = await removeValorantLeaderboardRegistration(entry.puuid, trimmed);
        showToast({ title: `${label} removed from the leaderboard`, tone: "success" });
        setLastRemoval(result.removalId ? { removalId: result.removalId, label } : null);
      }
      setRemovalsVersion((version) => version + 1);
      setServerChecksVersion((version) => version + 1);
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

  // Hide a listed player, or show a hidden one again. Either way they stay
  // registered, so nothing else on the page changes.
  const handleHideToggle = async (entry: ValorantLeaderboardRegistration) => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    const hidden = isHidden(entry);
    const label = `${entry.name}#${entry.tag}`;
    setSubmitting(true);
    try {
      if (hidden) {
        await unhideValorantLeaderboardRegistration(entry.puuid, trimmed);
        showToast({ title: `${label} is back on the public leaderboard`, tone: "success" });
      } else {
        await hideValorantLeaderboardRegistration(entry.puuid, trimmed);
        showToast({ title: `${label} hidden from the public leaderboard`, tone: "success" });
      }
      setServerChecksVersion((version) => version + 1);
      closeRemoval();
      if (hiddenOnly && hidden && entries.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        await registrationsQuery.refetch();
      }
    } catch (hideError) {
      const fallback = hidden ? "Could not show this player again." : "Could not hide this player.";
      showToast({ title: hideError instanceof Error ? hideError.message : fallback, tone: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleHiddenOnly = () => {
    closeRemoval();
    setPage(1);
    setHiddenOnly((current) => !current);
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
      setServerChecksVersion((version) => version + 1);
    }
  };

  return (
    <div className="grid min-w-0 gap-4 sm:gap-6">
      <div>
        <h3 className="text-lg font-semibold text-white">Leaderboard Players</h3>
        <p className="text-sm text-slate-400">
          Every player registered for the public VALORANT leaderboard, including the ones it currently hides. Without a
          search, players the rank updater has not refreshed for longest are listed first; with one, the best matches are.
          Hide keeps a player registered and connected but off the public board; Remove takes their registration away.
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

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={hiddenOnly ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={hiddenOnly}
          onClick={toggleHiddenOnly}
        >
          {hiddenOnly ? "Showing players hidden by staff" : "Show only players hidden by staff"}
        </Button>
        {hiddenOnly ? (
          <Button type="button" variant="ghost" size="sm" onClick={toggleHiddenOnly}>
            Show everyone
          </Button>
        ) : null}
      </div>

      {registrationsQuery.error ? (
        <ValorantErrorAlert message={registrationsQuery.error} onRetry={() => void registrationsQuery.refetch()} />
      ) : registrationsQuery.loading && !registrationsQuery.data ? (
        <ValorantLoadingState />
      ) : entries.length === 0 ? (
        <ValorantEmptyState
          title={query ? "No players match" : hiddenOnly ? "Nobody is hidden" : "No registered players"}
          description={
            query
              ? `No ${hiddenOnly ? "hidden " : "registered "}player matches “${query}”. Searches cover Discord usernames, Riot IDs and PUUIDs, including partial matches — check the spelling.`
              : hiddenOnly
                ? "Players you hide from the public leaderboard are listed here."
                : "Players appear here once they register for the leaderboard."
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-400" aria-live="polite">
              {total} {total === 1 ? "player" : "players"}
              {hiddenOnly ? " hidden by staff" : null}
              {query ? (
                <>
                  {" "}matching <span className="text-slate-200">&ldquo;{query}&rdquo;</span>
                </>
              ) : hiddenOnly ? null : " registered"}
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
                    const hiding = hidingPuuid === entry.puuid;
                    const hidden = isHidden(entry);
                    const stale = isStale(entry);
                    return (
                      <Fragment key={entry.puuid}>
                        <tr className={cn("border-b border-white/5", confirming && "bg-red-500/5", hiding && "bg-amber-400/5")}>
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
                          <td className="px-4 py-4 align-top">
                            <span
                              className={cn(
                                "inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs",
                                hidden
                                  ? "border-amber-300/25 bg-amber-300/10 text-amber-200"
                                  : entry.onLeaderboard
                                    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                                    : "border-white/10 bg-white/5 text-slate-400"
                              )}
                            >
                              {hidden ? "Hidden by staff" : entry.onLeaderboard ? "Listed" : "Not listed"}
                            </span>
                            {hidden ? (
                              <p className="mt-1 max-w-[16rem] break-words text-xs text-slate-500">
                                {entry.hiddenBy?.username ? `By ${entry.hiddenBy.username}` : "By staff"}
                                {entry.hiddenAt ? `, ${formatAdminCompactDateTime(entry.hiddenAt)}` : null}
                                {entry.hiddenReason ? <span className="block text-slate-400">{entry.hiddenReason}</span> : null}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-4 text-right">
                            {confirming || hiding ? null : (
                              <div className="flex justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={submitting}
                                  onClick={() => {
                                    setRemovingPuuid(null);
                                    setHidingPuuid(entry.puuid);
                                    setReason("");
                                  }}
                                >
                                  {hidden ? "Show" : "Hide"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={submitting}
                                  onClick={() => {
                                    setHidingPuuid(null);
                                    setRemovingPuuid(entry.puuid);
                                    setReason("");
                                  }}
                                >
                                  Remove
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {hiding ? (
                          <tr className="border-b border-white/5 bg-amber-400/5">
                            <td colSpan={6} className="px-4 pb-5">
                              <form
                                className="grid gap-3"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void handleHideToggle(entry);
                                }}
                              >
                                <div className="text-sm text-slate-300">
                                  <p className="font-semibold text-white">
                                    {hidden
                                      ? `Show ${entry.name}#${entry.tag} on the public leaderboard again?`
                                      : `Hide ${entry.name}#${entry.tag} from the public leaderboard?`}
                                  </p>
                                  {hidden ? (
                                    <p className="mt-2 text-slate-400">
                                      They go back on the board, its search and its stats straight away if they are ranked and
                                      have played in the last 14 days. The rank on their Quest profile returns with the next ranking sync.
                                    </p>
                                  ) : (
                                    <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-400">
                                      <li>They disappear from the public leaderboard, its search and its stats.</li>
                                      <li>
                                        They stay registered: their Quest account stays connected, the rank updater keeps their rank
                                        current and the Discord bot keeps their rank role.
                                      </li>
                                      <li>
                                        The rank on their Quest profile is cleared, and their profile tells them staff hid them, with
                                        your reason.
                                      </li>
                                      <li>You can show them again at any time.</li>
                                    </ul>
                                  )}
                                </div>
                                <label className="grid gap-1.5 text-sm text-slate-300">
                                  {hidden ? "Reason (kept in the audit log)" : "Reason (the player sees this on their profile)"}
                                  <Textarea
                                    value={reason}
                                    onChange={(event) => setReason(event.target.value)}
                                    maxLength={REASON_MAX_LENGTH}
                                    required
                                    autoFocus
                                    className="min-h-20"
                                    placeholder={
                                      hidden
                                        ? "e.g. Reviewed with the player; the account is their own."
                                        : "e.g. Under review: this account looks like a second account of another player."
                                    }
                                  />
                                </label>
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={closeRemoval}>
                                    Cancel
                                  </Button>
                                  <Button type="submit" size="sm" disabled={submitting || !reason.trim()}>
                                    {submitting ? (hidden ? "Showing…" : "Hiding…") : hidden ? "Show player" : "Hide player"}
                                  </Button>
                                </div>
                              </form>
                            </td>
                          </tr>
                        ) : null}
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
                                    {alsoBan ? (
                                      <li>
                                        Their Riot account and Discord account are banned: neither can register again, even under a
                                        new Riot ID, until you lift the ban under Banned players below. Anything else registered on
                                        either account is removed too.
                                      </li>
                                    ) : (
                                      <li>They can register again at any time, and you can restore them from Removed players below.</li>
                                    )}
                                  </ul>
                                </div>
                                <label className="flex items-start gap-2 text-sm text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={alsoBan}
                                    onChange={(event) => setAlsoBan(event.target.checked)}
                                    className="mt-0.5 h-4 w-4 accent-red-500"
                                  />
                                  <span>Also ban them from registering again</span>
                                </label>
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
                                    {submitting ? (alsoBan ? "Banning…" : "Removing…") : alsoBan ? "Remove and ban" : "Remove player"}
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

      <ValorantLeaderboardServerCheckPanel
        refreshToken={serverChecksVersion}
        onRemoved={({ removalId, label }) => {
          setLastRemoval(removalId ? { removalId, label } : null);
          setRemovalsVersion((version) => version + 1);
          void registrationsQuery.refetch();
        }}
      />

      <ValorantLeaderboardRemovalsPanel
        refreshToken={removalsVersion}
        onRestored={() => {
          setLastRemoval(null);
          setServerChecksVersion((version) => version + 1);
          void registrationsQuery.refetch();
        }}
        onBanned={() => {
          setLastRemoval(null);
          setBansVersion((version) => version + 1);
          setServerChecksVersion((version) => version + 1);
          void registrationsQuery.refetch();
        }}
      />

      <ValorantLeaderboardBansPanel
        refreshToken={bansVersion}
        // Lifting a ban can make a removal restorable again.
        onLifted={() => setRemovalsVersion((version) => version + 1)}
      />
    </div>
  );
}
