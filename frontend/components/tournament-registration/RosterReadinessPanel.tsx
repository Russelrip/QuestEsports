"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  fetchRosterReadiness,
  memberBlockingReason,
  requirementLabel,
  type ReadinessMember,
  type RosterReadiness,
} from "@/lib/registration-readiness";

type RosterReadinessPanelProps = {
  teamId: string;
  tournamentId: string;
  className?: string;
};

const roleLabel: Record<ReadinessMember["role"], string> = {
  CAPTAIN: "Captain",
  PLAYER: "Player",
  SUBSTITUTE: "Substitute",
  COACH: "Coach",
};

// A tick, a cross, or a dash for "this event does not ask for it". The dash
// matters: an empty cell reads as a failure a captain cannot fix.
const Mark = ({ state }: { state: "yes" | "no" | "not-required" }) => {
  if (state === "not-required") {
    return <span className="text-slate-600" aria-label="Not required">—</span>;
  }
  return state === "yes" ? (
    <span className="text-emerald-300" aria-label="Connected">✓</span>
  ) : (
    <span className="text-rose-300" aria-label="Missing">✗</span>
  );
};

export default function RosterReadinessPanel({
  teamId,
  tournamentId,
  className = "",
}: RosterReadinessPanelProps) {
  const [readiness, setReadiness] = useState<RosterReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReadiness(await fetchRosterReadiness(teamId, tournamentId));
    } catch (reason) {
      setReadiness(null);
      setError(reason instanceof Error ? reason.message : "Could not check roster readiness.");
    } finally {
      setLoading(false);
    }
  }, [teamId, tournamentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className={`rounded-[22px] border border-white/10 bg-white/[.02] p-5 ${className}`}>
        <p className="text-sm text-slate-400" role="status">Checking your roster…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-white/[.02] p-5 ${className}`}
        role="status"
      >
        {/* Deliberately not an error state. Readiness is a convenience; the
            server checks again on submit, so a failed check must not read as
            "you cannot register". */}
        <p className="text-sm text-slate-400">{error}</p>
        <Button type="button" size="sm" variant="ghost" onClick={() => void refresh()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!readiness) return null;

  const failing = readiness.requirements.filter((requirement) => requirement.status === "FAIL");

  return (
    <div
      className={`grid gap-4 rounded-[22px] border p-5 ${
        readiness.ready
          ? "border-emerald-300/25 bg-emerald-400/[.05]"
          : "border-amber-300/25 bg-amber-300/[.06]"
      } ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200/70">Roster check</p>
          <p className={`mt-2 font-semibold ${readiness.ready ? "text-emerald-100" : "text-amber-100"}`}>
            {readiness.ready
              ? "Every roster member is ready."
              : `${failing.length} requirement${failing.length === 1 ? "" : "s"} still to sort out.`}
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => void refresh()}>
          Re-check
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.15em] text-slate-500">
              <th scope="col" className="py-2 pr-3 font-medium">Member</th>
              <th scope="col" className="py-2 pr-3 font-medium">Quest</th>
              <th scope="col" className="py-2 pr-3 font-medium">Discord</th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {readiness.game ? readiness.game.toUpperCase() : "Game"}
                <span className="ml-2 normal-case tracking-normal text-slate-600">optional</span>
              </th>
              <th scope="col" className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {readiness.members.map((member) => {
              const reason = memberBlockingReason(member);
              return (
                <tr key={member.id} className="border-t border-white/8 align-top">
                  <td className="py-3 pr-3">
                    <span className="text-white">{member.name}</span>
                    <span className="ml-2 text-xs text-slate-500">{roleLabel[member.role]}</span>
                  </td>
                  <td className="py-3 pr-3">
                    <Mark state={member.hasQuestAccount ? "yes" : "no"} />
                  </td>
                  <td className="py-3 pr-3">
                    <Mark
                      state={
                        member.requiresDiscord
                          ? member.hasDiscord ? "yes" : "no"
                          : member.hasDiscord ? "yes" : "not-required"
                      }
                    />
                  </td>
                  {/* Never a cross. A game account earns a player their place on
                      the leaderboard; it has never been what lets a team enter,
                      and a red mark here had captains chasing teammates over a
                      requirement that does not exist. */}
                  <td className="py-3 pr-3">
                    <Mark state={member.gameAccount ? "yes" : "not-required"} />
                    {member.gameAccount ? (
                      <span className="ml-2 text-xs text-slate-400">
                        {member.gameAccount.username}#{member.gameAccount.tagline}
                      </span>
                    ) : member.legacyRiotId ? (
                      <span className="ml-2 text-xs text-slate-500">
                        {member.legacyRiotId} <span className="text-slate-600">(typed)</span>
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3">
                    {member.ready ? (
                      <span className="text-emerald-300">Ready</span>
                    ) : (
                      <span className="text-amber-200">{reason ?? "Action required"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {failing.length > 0 ? (
        <ul className="grid gap-1 text-sm text-slate-300">
          {failing.map((requirement) => (
            <li key={requirement.type}>• {requirementLabel(requirement)}</li>
          ))}
        </ul>
      ) : null}

      {/* The fix is on each player's own profile, so point there rather than
          leaving a captain to chase people without knowing what to ask for. */}
      {readiness.ready ? null : (
        <p className="text-sm leading-6 text-slate-400">
          Roster members connect Discord on their own Quest profile, under Linked
          accounts. Ask anyone marked above to do that, then re-check.
        </p>
      )}

      {/* Says plainly what the game column is for, so a blank one does not read
          as something left undone. */}
      {readiness.game ? (
        <p className="text-sm leading-6 text-slate-500">
          Connecting a {readiness.game.toUpperCase()} account is optional and up to
          each player — it is what puts them on the leaderboard and records the
          account they played under. It does not hold up this registration.
        </p>
      ) : null}
    </div>
  );
}
