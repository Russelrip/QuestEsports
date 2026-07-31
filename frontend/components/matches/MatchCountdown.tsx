"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { LiveMatch } from "@/lib/matches";
import { matchStatusLabel, matchStatusTone } from "@/lib/matches";
import { getRemaining, splitDuration } from "@/lib/match-time";

function TimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0 border border-white/10 bg-black/20 px-2 py-3 text-center sm:px-4">
      <strong className="block font-display text-2xl leading-none text-white sm:text-3xl">{String(value).padStart(2, "0")}</strong>
      <span className="mt-2 block text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
    </div>
  );
}

export default function MatchCountdown({
  match,
  serverNow,
  onReachedZero,
}: {
  match: LiveMatch | null;
  serverNow: string;
  onReachedZero?: () => void;
}) {
  const targetValue = match?.estimatedAt || match?.scheduledAt || null;
  const target = targetValue ? new Date(targetValue).getTime() : null;
  const serverTimestamp = new Date(serverNow).getTime();
  const [remaining, setRemaining] = useState(() => target && Number.isFinite(serverTimestamp) ? Math.max(0, target - serverTimestamp) : 0);
  const completedTargetRef = useRef<number | null>(null);

  useEffect(() => {
    if (!target) return;
    const offset = Number.isFinite(serverTimestamp) ? serverTimestamp - Date.now() : 0;
    const tick = () => {
      const next = getRemaining(target, offset);
      setRemaining(next);
      if (next === 0 && completedTargetRef.current !== target) {
        completedTargetRef.current = target;
        onReachedZero?.();
      }
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [onReachedZero, serverTimestamp, target]);

  if (!match) {
    return <p className="text-sm text-slate-400">No match is scheduled yet. New fixtures will appear here when published.</p>;
  }

  const [teamA, teamB] = match.participants;
  const delayed = match.status === "delayed";
  const active = ["live", "ready", "paused", "veto_in_progress", "check_in_open"].includes(match.status);
  const parts = splitDuration(remaining);

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="overflow-wrap-anywhere text-lg font-semibold text-white">{teamA?.displayName || "TBD"} <span className="text-slate-500">vs</span> {teamB?.displayName || "TBD"}</p>
          <p className="overflow-wrap-anywhere mt-1 text-xs text-slate-400">{match.tournament.title} · {match.roundNumber ? `Round ${match.roundNumber}` : match.identifier}</p>
        </div>
        <Badge className={matchStatusTone(match.status)}>{matchStatusLabel(match.status)}</Badge>
      </div>

      {delayed ? (
        <div className="mt-5 border-l-2 border-amber-300 bg-amber-400/8 p-4">
          <p className="font-semibold text-amber-100">Match delayed</p>
          <p className="mt-1 text-sm text-slate-300">{match.estimatedAt ? `Updated estimate: ${new Date(match.estimatedAt).toLocaleString()}` : "An updated start time will be published shortly."}</p>
        </div>
      ) : active && match.status !== "scheduled" ? (
        <p className="mt-5 border-l-2 border-emerald-300 bg-emerald-400/8 p-4 text-sm text-emerald-100">This match is {matchStatusLabel(match.status).toLowerCase()}.</p>
      ) : target ? (
        <div className="mt-5 grid grid-cols-4 gap-2" aria-label="Time until match starts">
          <TimeUnit value={parts.days} label="Days" />
          <TimeUnit value={parts.hours} label="Hours" />
          <TimeUnit value={parts.minutes} label="Minutes" />
          <TimeUnit value={parts.seconds} label="Seconds" />
        </div>
      ) : (
        <p className="mt-5 text-sm text-slate-400">The fixture is published, but its start time is still to be announced.</p>
      )}
    </div>
  );
}
