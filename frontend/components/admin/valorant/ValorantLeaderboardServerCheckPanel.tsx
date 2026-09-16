"use client";

import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useValorantServerChecks } from "@/hooks/api/useValorant";
import { useToastStore } from "@/hooks/useToastStore";
import { formatAdminCompactDateTime } from "@/lib/admin";
import { formatSriLankaDate } from "@/lib/date-time";
import { cn } from "@/lib/utils";
import {
  SERVER_CHECK_SORT_OPTIONS,
  buildValorantTrackerProfileUrl,
  describeServerCheckRule,
  serverCheckReasonLines,
  serverCheckStatusLine,
  serverShareLabel,
  type ValorantLeaderboardActor,
  type ValorantServerCheck,
  type ValorantServerCheckRule,
  type ValorantServerCheckSort,
  type ValorantServerCheckView,
} from "@/lib/valorant";
import {
  clearValorantServerCheck,
  removeValorantLeaderboardRegistration,
  reopenValorantServerCheck,
} from "@/lib/valorant-api";

const REASON_MAX_LENGTH = 500;

type View = ValorantServerCheckView;

const VIEW_LABELS: Record<View, string> = { flagged: "Flagged", cleared: "Kept", all: "All players" };
type Action = { puuid: string; kind: "keep" | "remove" | "reopen" };

const actorName = (actor: ValorantLeaderboardActor | null) =>
  actor ? (actor.username ? `@${actor.username}` : "a deleted account") : "unknown";

const EMPTY_RULE: ValorantServerCheckRule = {
  homeClusters: [],
  homeShard: null,
  windowDays: null,
  minMatches: null,
  awayShare: null,
};

function ServerChips({ entry }: { entry: ValorantServerCheck }) {
  if (entry.servers.length === 0) {
    return <p className="text-slate-500">No competitive matches recorded</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Recent competitive matches by server">
      {entry.servers.map((server) => (
        <li
          key={server.cluster ?? "unknown"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
            server.home === false
              ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
              : server.home
                ? "border-white/10 bg-white/5 text-slate-300"
                : "border-dashed border-white/10 text-slate-500"
          )}
        >
          {server.cluster ?? "Unknown server"}
          <span className="font-semibold tabular-nums">{server.matches}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ValorantLeaderboardServerCheckPanel({
  refreshToken,
  onRemoved,
}: {
  // Bumped by the players table after a removal or restore elsewhere on the page.
  refreshToken: number;
  onRemoved: (removal: { removalId: string | null; label: string }) => void;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [view, setView] = useState<View>("flagged");
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [server, setServer] = useState("");
  const [sort, setSort] = useState<ValorantServerCheckSort>("default");
  const checksQuery = useValorantServerChecks(view, page, query, server, sort);
  const { refetch } = checksQuery;
  const entries = checksQuery.data?.entries ?? [];
  const totalPages = checksQuery.data?.totalPages ?? 1;
  const summary = checksQuery.data?.summary;
  const rule = checksQuery.data?.rule ?? EMPTY_RULE;
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void refetch();
  }, [refreshToken, refetch]);

  const closeAction = () => {
    setAction(null);
    setReason("");
  };

  const openAction = (next: Action) => {
    setAction(next);
    setReason("");
  };

  const switchView = (next: View) => {
    if (next === view) return;
    closeAction();
    setPage(1);
    setView(next);
  };

  // Clicking a server lists everyone who played there, whatever view was open.
  const toggleServer = (cluster: string) => {
    closeAction();
    setPage(1);
    if (server === cluster) {
      setServer("");
      return;
    }
    setServer(cluster);
    setView("all");
  };

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    closeAction();
    setPage(1);
    setQuery(search.trim());
  };

  const clearFilters = () => {
    closeAction();
    setPage(1);
    setSearch("");
    setQuery("");
    setServer("");
  };

  const serverTotals = summary?.servers ?? [];
  const filtered = Boolean(query || server);

  const submitAction = async (entry: ValorantServerCheck, kind: Action["kind"]) => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    const label = `${entry.name}#${entry.tag}`;
    setSubmitting(true);
    try {
      if (kind === "remove") {
        const result = await removeValorantLeaderboardRegistration(entry.puuid, trimmed);
        showToast({ title: `${label} removed from the leaderboard`, tone: "success" });
        onRemoved({ removalId: result.removalId, label });
      } else if (kind === "keep") {
        await clearValorantServerCheck(entry.puuid, trimmed);
        showToast({ title: `${label} kept on the leaderboard`, tone: "success" });
      } else {
        await reopenValorantServerCheck(entry.puuid, trimmed);
        showToast({ title: `Server check reopened for ${label}`, tone: "success" });
      }
      closeAction();
      if (entries.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        await refetch();
      }
    } catch (actionError) {
      const fallback = kind === "remove" ? "Could not remove this player." : "Could not update this server check.";
      showToast({ title: actionError instanceof Error ? actionError.message : fallback, tone: "error" });
      void refetch();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-w-0 gap-4">
      <div>
        <h3 className="text-lg font-semibold text-white">Server check</h3>
        <p className="text-sm text-slate-400">
          Which servers registered players play competitive on, and the ones that suggest they may not be playing from
          Sri Lanka.{" "}
          {checksQuery.data ? describeServerCheckRule(rule) : null} Nothing is removed automatically: someone living
          abroad looks the same, so review each player, then keep or remove them.
        </p>
        {summary ? (
          <p className="mt-2 text-xs text-slate-500" aria-live="polite">
            Servers checked for {summary.checked} of {summary.registered} players
            {summary.checked < summary.registered
              ? ". The rank updater checks each player about once a day, so the rest follow on its next passes."
              : "."}
          </p>
        ) : null}
      </div>

      {serverTotals.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Where the leaderboard plays{rule.windowDays ? ` · last ${rule.windowDays} days` : ""}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by server">
            {serverTotals.map((total) => {
              const active = server === total.cluster;
              return (
                <button
                  key={total.cluster}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleServer(total.cluster)}
                  className={cn(
                    "inline-flex items-baseline gap-2 rounded-xl border px-3 py-1.5 text-left text-sm transition-colors",
                    active
                      ? "border-white/40 bg-white/10 text-white"
                      : total.home
                        ? "border-white/10 bg-white/5 text-slate-200 hover:border-white/20"
                        : "border-amber-400/30 bg-amber-400/10 text-amber-100 hover:border-amber-300/50"
                  )}
                >
                  <span className="font-semibold">{total.cluster}</span>
                  <span className="tabular-nums">{serverShareLabel(total, serverTotals)}</span>
                  <span className="text-xs tabular-nums text-slate-400">
                    {total.players} {total.players === 1 ? "player" : "players"} · {total.matches} matches
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Server check view">
          {(["flagged", "cleared", "all"] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={view === option ? "primary" : "ghost"}
              aria-pressed={view === option}
              onClick={() => switchView(option)}
            >
              {VIEW_LABELS[option]}
              {summary ? (
                <span className="ml-2 tabular-nums text-slate-400">
                  {option === "flagged" ? summary.flagged : option === "cleared" ? summary.cleared : summary.registered}
                </span>
              ) : null}
            </Button>
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="flex min-w-0 items-center gap-2 whitespace-nowrap text-sm text-slate-400">
          Sort by
          <Select
            value={sort}
            onChange={(event) => {
              closeAction();
              setPage(1);
              setSort(event.target.value as ValorantServerCheckSort);
            }}
            className="h-10 w-auto rounded-xl py-0"
          >
            {SERVER_CHECK_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value === "default"
                  ? view === "flagged" && !server
                    ? "Suggested (most away first)"
                    : view === "cleared" && !server
                      ? "Suggested (latest kept first)"
                      : server
                        ? `Suggested (most matches on ${server})`
                        : "Suggested (name)"
                  : option.label}
              </option>
            ))}
          </Select>
        </label>
        <form className="flex min-w-0 gap-2" onSubmit={handleSearch} role="search">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Riot ID or Discord"
            aria-label="Search server check players"
            className="h-10 w-56 max-w-full"
          />
          <Button type="submit" size="sm" variant="ghost">
            Search
          </Button>
        </form>
        </div>
      </div>

      {filtered ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400" aria-live="polite">
          <span>
            {checksQuery.data ? `${checksQuery.data.total} ${checksQuery.data.total === 1 ? "player" : "players"}` : "Players"}
            {server ? (
              <>
                {" "}who played on <span className="text-slate-200">{server}</span>
              </>
            ) : null}
            {query ? (
              <>
                {" "}matching <span className="text-slate-200">&ldquo;{query}&rdquo;</span>
              </>
            ) : null}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : null}

      {checksQuery.error ? (
        <ValorantErrorAlert message={checksQuery.error} onRetry={() => void refetch()} />
      ) : checksQuery.loading && !checksQuery.data ? (
        <ValorantLoadingState />
      ) : entries.length === 0 ? (
        <ValorantEmptyState
          title={filtered ? "No players match" : view === "flagged" ? "No players flagged" : view === "cleared" ? "No players kept" : "No registered players"}
          description={
            filtered
              ? "Nobody in this view matches the server or search. Clear the filters to see everyone."
              : view === "flagged"
                ? "No checked player currently plays mostly away from the home servers."
                : view === "cleared"
                  ? "Players you keep after reviewing a flag appear here, where the decision can be reopened."
                  : "Players appear here once they register for the leaderboard."
          }
        />
      ) : (
        <>
          <Card className={cn("min-w-0 overflow-hidden transition-opacity", checksQuery.loading && "opacity-60")}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    <th scope="col" className="px-4 py-3">Player</th>
                    <th scope="col" className="px-4 py-3">Servers</th>
                    <th scope="col" className="px-4 py-3">
                      {view === "flagged" ? "Why flagged" : view === "cleared" ? "Kept" : "Check"}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const open = action?.puuid === entry.puuid ? action : null;
                    const trackerUrl = buildValorantTrackerProfileUrl(entry.name, entry.tag);
                    const label = `${entry.name}#${entry.tag}`;
                    return (
                      <Fragment key={entry.puuid}>
                        <tr
                          className={cn(
                            "border-b border-white/5 align-top",
                            open?.kind === "remove" && "bg-red-500/5",
                            open && open.kind !== "remove" && "bg-white/[0.03]"
                          )}
                        >
                          <td className="px-4 py-4">
                            <p className="font-semibold text-white">{label}</p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {entry.discordUsername ? `@${entry.discordUsername}` : "No Discord linked"}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              {entry.currentTier ?? "Unrated"}
                              {entry.elo !== null ? ` · ${entry.elo} ELO` : ""}
                              {entry.onLeaderboard ? " · Listed" : " · Hidden"}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <ServerChips entry={entry} />
                            <p className="mt-1.5 text-xs text-slate-500">
                              Since {formatSriLankaDate(entry.since)}
                              {entry.checkedAt ? ` · checked ${formatAdminCompactDateTime(entry.checkedAt)}` : " · not checked yet"}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-slate-300">
                            {entry.status === "flagged" ? (
                              <>
                                <ul className="space-y-1">
                                  {serverCheckReasonLines(entry, rule).map((line) => (
                                    <li key={line}>{line}</li>
                                  ))}
                                </ul>
                                {entry.clearedAt ? (
                                  <p className="mt-1 text-xs text-amber-200/80">
                                    Flagged again after being kept on {formatSriLankaDate(entry.clearedAt)} by{" "}
                                    {actorName(entry.clearedBy)}
                                  </p>
                                ) : null}
                              </>
                            ) : entry.status === "cleared" ? (
                              <>
                                <p>Kept {entry.clearedAt ? formatAdminCompactDateTime(entry.clearedAt) : ""}</p>
                                <p className="mt-0.5 text-xs text-slate-500">by {actorName(entry.clearedBy)}</p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  Only matches after this can flag them again.
                                </p>
                              </>
                            ) : (
                              <p className={entry.status === "clear" ? "text-slate-300" : "text-slate-500"}>
                                {serverCheckStatusLine(entry, rule)}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex justify-end gap-1 whitespace-nowrap">
                              {trackerUrl ? (
                                <a
                                  href={trackerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex h-10 items-center rounded-xl px-3 text-sm text-slate-300 hover:bg-white/6 hover:text-white"
                                >
                                  tracker.gg
                                </a>
                              ) : null}
                              {open ? null : entry.status === "flagged" ? (
                                <>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={submitting}
                                    onClick={() => openAction({ puuid: entry.puuid, kind: "keep" })}
                                  >
                                    Keep
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={submitting}
                                    onClick={() => openAction({ puuid: entry.puuid, kind: "remove" })}
                                  >
                                    Remove
                                  </Button>
                                </>
                              ) : entry.status === "cleared" ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={submitting}
                                  onClick={() => openAction({ puuid: entry.puuid, kind: "reopen" })}
                                >
                                  Reopen
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {open ? (
                          <tr className={cn("border-b border-white/5", open.kind === "remove" ? "bg-red-500/5" : "bg-white/[0.03]")}>
                            <td colSpan={4} className="px-4 pb-5">
                              <form
                                className="grid gap-3"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void submitAction(entry, open.kind);
                                }}
                              >
                                <div className="text-sm text-slate-300">
                                  <p className="font-semibold text-white">
                                    {open.kind === "keep"
                                      ? `Keep ${label} on the leaderboard?`
                                      : open.kind === "remove"
                                        ? `Remove ${label} from the leaderboard?`
                                        : `Reopen the server check for ${label}?`}
                                  </p>
                                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-400">
                                    {open.kind === "keep" ? (
                                      <>
                                        <li>They stay registered and move to Kept.</li>
                                        <li>The matches so far stop counting. Enough away matches after today flag them again.</li>
                                      </>
                                    ) : open.kind === "remove" ? (
                                      <>
                                        <li>The same as Remove in the players table: off the public leaderboard, out of the rank updater and Discord bot passes, and their profile rank is cleared.</li>
                                        <li>You can undo it straight away, or restore them later from Removed players.</li>
                                      </>
                                    ) : (
                                      <>
                                        <li>Every match in the window counts again, so they return to Flagged if they still meet the rule.</li>
                                      </>
                                    )}
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
                                    placeholder={
                                      open.kind === "keep"
                                        ? "e.g. Sri Lankan studying in Melbourne; confirmed with them on Discord."
                                        : open.kind === "remove"
                                          ? "e.g. Plays from Australia; not eligible for the Sri Lankan leaderboard."
                                          : "e.g. Kept the wrong player."
                                    }
                                  />
                                </label>
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={closeAction}>
                                    Cancel
                                  </Button>
                                  <Button
                                    type="submit"
                                    variant={open.kind === "remove" ? "danger" : "primary"}
                                    size="sm"
                                    disabled={submitting || !reason.trim()}
                                  >
                                    {submitting
                                      ? "Saving…"
                                      : open.kind === "keep"
                                        ? "Keep player"
                                        : open.kind === "remove"
                                          ? "Remove player"
                                          : "Reopen check"}
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
                disabled={page <= 1 || checksQuery.loading}
                onClick={() => {
                  closeAction();
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
                disabled={page >= totalPages || checksQuery.loading}
                onClick={() => {
                  closeAction();
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
