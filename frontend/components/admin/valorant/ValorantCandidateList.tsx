"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAdminCompactDateTime } from "@/lib/admin";
import type { MatchCandidate } from "@/lib/valorant";

export default function ValorantCandidateList({
  candidates,
  onSelect,
}: {
  candidates: MatchCandidate[];
  onSelect: (candidate: MatchCandidate) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <th scope="col" className="px-4 py-3 font-semibold">Match ID</th>
            <th scope="col" className="px-4 py-3 font-semibold">Map</th>
            <th scope="col" className="px-4 py-3 font-semibold">Started</th>
            <th scope="col" className="px-4 py-3 font-semibold">Mode / Queue</th>
            <th scope="col" className="px-4 py-3 font-semibold">Score</th>
            <th scope="col" className="px-4 py-3 font-semibold">Imported</th>
            <th scope="col" className="px-4 py-3 font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => (
            <tr key={candidate.henrikMatchId} className="border-b border-white/5 text-slate-300">
              <td className="px-4 py-3">
                <span className="cursor-help font-mono text-xs" title={candidate.henrikMatchId}>
                  {candidate.henrikMatchId.slice(0, 12)}…
                </span>
              </td>
              <td className="px-4 py-3">{candidate.map ?? "Unknown map"}</td>
              <td className="px-4 py-3 whitespace-nowrap">{formatAdminCompactDateTime(candidate.startedAt)}</td>
              <td className="px-4 py-3">
                {candidate.mode ?? "—"} / {candidate.queue ?? "—"}
              </td>
              <td className="px-4 py-3">
                <span aria-label="Red score vs Blue score" className="font-mono">
                  {candidate.redScore ?? 0}–{candidate.blueScore ?? 0}
                </span>
              </td>
              <td className="px-4 py-3">
                {candidate.alreadyImported ? <Badge>Imported</Badge> : <Badge>New</Badge>}
              </td>
              <td className="px-4 py-3">
                <Button type="button" variant="secondary" size="sm" onClick={() => onSelect(candidate)}>
                  Review
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
