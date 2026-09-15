"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useValorantServerChecks } from "@/hooks/api/useValorant";
import { useToastStore } from "@/hooks/useToastStore";
import { formatAdminCompactDateTime } from "@/lib/admin";
import { formatSriLankaDate } from "@/lib/date-time";
import { cn } from "@/lib/utils";
import {
  buildValorantTrackerProfileUrl,
  describeServerCheckRule,
  serverCheckReasonLines,
  type ValorantLeaderboardActor,
  type ValorantServerCheck,
  type ValorantServerCheckRule,
} from "@/lib/valorant";
import {
  clearValorantServerCheck,
  removeValorantLeaderboardRegistration,
  reopenValorantServerCheck,
} from "@/lib/valorant-api";

const REASON_MAX_LENGTH = 500;

type View = "flagged" | "cleared";
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
  const checksQuery = useValorantServerChecks(view, page);
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
          Players whose recent competitive matches suggest they may not be playing from Sri Lanka.{" "}
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

      <div className="flex flex-wrap gap-2" role="group" aria-label="Server check view">
        {(["flagged", "cleared"] as const).map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={view === option ? "primary" : "ghost"}
            aria-pressed={view === option}
            onClick={() => switchView(option)}
          >
            {option === "flagged" ? "Flagged" : "Kept"}
            {summary ? (
              <span className="ml-2 tabular-nums text-slate-400">
                {option === "flagged" ? summary.flagged : summary.cleared}
              </span>
            ) : null}
          </Button>
        ))}
      </div>

      {checksQuery.error ? (
        <ValorantErrorAlert message={checksQuery.error} onRetry={() => void refetch()} />
      ) : checksQuery.loading && !checksQuery.data ? (
        <ValorantLoadingState />
      ) : entries.length === 0 ? (
        <ValorantEmptyState
          title={view === "flagged" ? "No players flagged" : "No players kept"}
          description={
            view === "flagged"
              ? "No checked player currently plays mostly away from the home servers."
              : "Players you keep after reviewing a flag appear here, where the decision can be reopened."
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
                    <th scope="col" className="px-4 py-3">{view === "flagged" ? "Why flagged" : "Kept"}</th>
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
                            {view === "flagged" ? (
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
                            ) : (
                              <>
                                <p>{entry.clearedAt ? formatAdminCompactDateTime(entry.clearedAt) : "—"}</p>
                                <p className="mt-0.5 text-xs text-slate-500">by {actorName(entry.clearedBy)}</p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  Only matches after this can flag them again.
                                </p>
                              </>
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
                              {open ? null : view === "flagged" ? (
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
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={submitting}
                                  onClick={() => openAction({ puuid: entry.puuid, kind: "reopen" })}
                                >
                                  Reopen
                                </Button>
                              )}
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
