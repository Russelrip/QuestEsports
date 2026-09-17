"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import ValorantEmptyState from "@/components/admin/valorant/ValorantEmptyState";
import ValorantErrorAlert from "@/components/admin/valorant/ValorantErrorAlert";
import ValorantLoadingState from "@/components/admin/valorant/ValorantLoadingState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useValorantLeaderboardBans } from "@/hooks/api/useValorant";
import { useToastStore } from "@/hooks/useToastStore";
import { formatAdminCompactDateTime } from "@/lib/admin";
import { cn } from "@/lib/utils";
import {
  leaderboardBanCovers,
  type ValorantLeaderboardActor,
  type ValorantLeaderboardBan,
  type ValorantLeaderboardBanStatus,
} from "@/lib/valorant";
import { liftValorantLeaderboardBan } from "@/lib/valorant-api";

const REASON_MAX_LENGTH = 500;

const VIEW_LABELS: Record<ValorantLeaderboardBanStatus, string> = {
  active: "Active",
  lifted: "Lifted",
  all: "All",
};

const actorName = (actor: ValorantLeaderboardActor | null) =>
  actor ? (actor.username ? `@${actor.username}` : "a deleted account") : "unknown";

export default function ValorantLeaderboardBansPanel({
  refreshToken,
  onLifted,
}: {
  // Bumped after a ban is made elsewhere on the page, so it shows here.
  refreshToken: number;
  onLifted: () => void;
}) {
  const showToast = useToastStore((state) => state.showToast);
  const [view, setView] = useState<ValorantLeaderboardBanStatus>("active");
  const [page, setPage] = useState(1);
  const [liftingId, setLiftingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const bansQuery = useValorantLeaderboardBans(view, page);
  const { refetch } = bansQuery;
  const entries = bansQuery.data?.entries ?? [];
  const totalPages = bansQuery.data?.totalPages ?? 1;
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // A new ban lands on the first page.
    setPage(1);
    void refetch();
  }, [refreshToken, refetch]);

  const closeLift = () => {
    setLiftingId(null);
    setReason("");
  };

  const switchView = (next: ValorantLeaderboardBanStatus) => {
    closeLift();
    setPage(1);
    setView(next);
  };

  const handleLift = async (ban: ValorantLeaderboardBan) => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await liftValorantLeaderboardBan(ban.banId, trimmed);
      showToast({ title: `Ban on ${ban.name}#${ban.tag} lifted; they can register again`, tone: "success" });
      closeLift();
      onLifted();
    } catch (liftError) {
      const message = liftError instanceof Error ? liftError.message : "Could not lift this ban.";
      showToast({ title: message, tone: "error" });
    } finally {
      setSubmitting(false);
      void refetch();
    }
  };

  return (
    <div className="grid min-w-0 gap-4">
      <div>
        <h3 className="text-lg font-semibold text-white">Banned players</h3>
        <p className="text-sm text-slate-400">
          Players who cannot register for the leaderboard. A ban covers the Riot account and the Discord account, so a new
          Riot ID does not get around it. Ban a player when removing them above, or from Removed players.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Ban view">
        {(["active", "lifted", "all"] as const).map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={view === option ? "primary" : "ghost"}
            aria-pressed={view === option}
            onClick={() => switchView(option)}
          >
            {VIEW_LABELS[option]}
          </Button>
        ))}
      </div>

      {bansQuery.error ? (
        <ValorantErrorAlert message={bansQuery.error} onRetry={() => void refetch()} />
      ) : bansQuery.loading && !bansQuery.data ? (
        <ValorantLoadingState />
      ) : entries.length === 0 ? (
        <ValorantEmptyState
          title={view === "lifted" ? "No lifted bans" : "No banned players"}
          description={
            view === "lifted"
              ? "Bans you lift stay listed here."
              : "Players you ban from the leaderboard appear here, where a ban can be lifted."
          }
        />
      ) : (
        <>
          <Card className={cn("min-w-0 overflow-hidden transition-opacity", bansQuery.loading && "opacity-60")}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    <th scope="col" className="px-4 py-3">Player when banned</th>
                    <th scope="col" className="px-4 py-3">Covers</th>
                    <th scope="col" className="px-4 py-3">Reason</th>
                    <th scope="col" className="px-4 py-3">Banned</th>
                    <th scope="col" className="px-4 py-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((ban) => {
                    const confirming = liftingId === ban.banId;
                    return (
                      <Fragment key={ban.banId}>
                        <tr className={cn("border-b border-white/5", confirming && "bg-emerald-500/5")}>
                          <td className="px-4 py-4">
                            <p className="font-semibold text-white">{ban.name}#{ban.tag}</p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {ban.discordUsername ? `@${ban.discordUsername}` : "No Discord linked"}
                            </p>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-slate-300">{leaderboardBanCovers(ban)}</td>
                          <td className="px-4 py-4 text-slate-300">
                            <p className="max-w-xs break-words">{ban.reason ?? "—"}</p>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <p className="text-slate-300">{formatAdminCompactDateTime(ban.bannedAt)}</p>
                            <p className="mt-0.5 text-xs text-slate-500">by {actorName(ban.bannedBy)}</p>
                          </td>
                          <td className="px-4 py-4 text-right whitespace-nowrap">
                            {ban.liftedAt ? (
                              <>
                                <p className="text-slate-300">Lifted</p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {formatAdminCompactDateTime(ban.liftedAt)} by {actorName(ban.liftedBy)}
                                </p>
                              </>
                            ) : confirming ? (
                              <p className="text-red-200">Banned</p>
                            ) : (
                              <div className="flex items-center justify-end gap-3">
                                <span className="text-red-200">Banned</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={submitting}
                                  onClick={() => {
                                    setLiftingId(ban.banId);
                                    setReason("");
                                  }}
                                >
                                  Lift ban
                                </Button>
                              </div>
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
                                  void handleLift(ban);
                                }}
                              >
                                <div className="text-sm text-slate-300">
                                  <p className="font-semibold text-white">Lift the ban on {ban.name}#{ban.tag}?</p>
                                  <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-400">
                                    <li>Their {leaderboardBanCovers(ban)} can register for the leaderboard again.</li>
                                    <li>They are not put back on the leaderboard. Restore them from Removed players, or they can register again.</li>
                                    <li>The ban stays listed under Lifted.</li>
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
                                    placeholder="e.g. Appeal accepted after talking to them on Discord."
                                  />
                                </label>
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={closeLift}>
                                    Cancel
                                  </Button>
                                  <Button type="submit" size="sm" disabled={submitting || !reason.trim()}>
                                    {submitting ? "Lifting…" : "Lift ban"}
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
                disabled={page <= 1 || bansQuery.loading}
                onClick={() => {
                  closeLift();
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
                disabled={page >= totalPages || bansQuery.loading}
                onClick={() => {
                  closeLift();
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
