import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { LiveMatch } from "@/lib/matches";
import { matchStatusLabel, matchStatusTone } from "@/lib/matches";

export default function MatchCard({ match }: { match: LiveMatch }) {
  const [teamA, teamB] = match.participants;
  const displayTime = match.estimatedAt || match.scheduledAt;
  return (
    <article className="flex min-w-0 flex-col border border-white/10 bg-[#11131b] p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/tournaments/${match.tournament.slug}`} className="overflow-wrap-anywhere text-xs font-semibold uppercase tracking-[0.15em] text-blue-200">
            {match.tournament.title}
          </Link>
          <p className="mt-1 text-xs text-slate-500">{match.roundNumber ? `Round ${match.roundNumber}` : match.identifier}</p>
        </div>
        <Badge className={matchStatusTone(match.status)}>{matchStatusLabel(match.status)}</Badge>
      </div>
      <div className="mt-5 grid min-w-0 gap-2">
        <p className={`overflow-wrap-anywhere border-l-2 px-3 py-2 text-sm font-semibold ${match.winnerSlot === 1 ? "border-emerald-300 bg-emerald-400/8 text-white" : "border-white/15 bg-white/[0.025] text-slate-200"}`}>
          {teamA?.displayName || "TBD"}<span className="float-right ml-2 text-white">{teamA?.score ?? ""}</span>
        </p>
        <p className={`overflow-wrap-anywhere border-l-2 px-3 py-2 text-sm font-semibold ${match.winnerSlot === 2 ? "border-emerald-300 bg-emerald-400/8 text-white" : "border-white/15 bg-white/[0.025] text-slate-200"}`}>
          {teamB?.displayName || "TBD"}<span className="float-right ml-2 text-white">{teamB?.score ?? ""}</span>
        </p>
      </div>
      <div className="mt-auto flex flex-wrap justify-between gap-2 pt-5 text-xs text-slate-500">
        <span>{displayTime ? new Date(displayTime).toLocaleString() : "Time TBA"}</span>
        {match.station ? <span>{match.station}</span> : null}
      </div>
    </article>
  );
}
