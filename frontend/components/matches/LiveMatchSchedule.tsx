"use client";

import { useCallback, useEffect } from "react";
import { buildApiUrl } from "@/lib/api";
import { fetchNextMatch, fetchTournamentMatches, type LiveMatch } from "@/lib/matches";
import { useApiQuery } from "@/hooks/api/useApiQuery";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import MatchCountdown from "@/components/matches/MatchCountdown";
import MatchCard from "@/components/matches/MatchCard";

type ScheduleData = { matches: LiveMatch[]; nextMatch: LiveMatch | null; serverNow: string };

export default function LiveMatchSchedule({
  tournamentSlug,
  scope = "public",
  showList = true,
}: {
  tournamentSlug?: string;
  scope?: "public" | "me";
  showList?: boolean;
}) {
  const query = useCallback(async (): Promise<ScheduleData> => {
    if (tournamentSlug) {
      const response = await fetchTournamentMatches(tournamentSlug);
      const active = response.data.find((match) => !["completed", "cancelled", "walkover"].includes(match.status)) || null;
      return { matches: response.data, nextMatch: active, serverNow: response.meta.serverNow };
    }
    const response = await fetchNextMatch(scope);
    return { matches: response.data ? [response.data] : [], nextMatch: response.data, serverNow: response.meta.serverNow };
  }, [scope, tournamentSlug]);
  const { data, error, loading, refetch } = useApiQuery<ScheduleData>(
    ["live-match-schedule", tournamentSlug || scope],
    query
  );

  useEffect(() => {
    let backgroundTicks = 0;
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        backgroundTicks = 0;
        void refetch();
      } else if (++backgroundTicks >= 4) {
        backgroundTicks = 0;
        void refetch();
      }
    }, 15_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    let stream: EventSource | null = null;
    try {
      stream = new EventSource(buildApiUrl("/api/v1/events?topics=matches"), { withCredentials: true });
      stream.addEventListener("update", () => void refetch());
    } catch {
      stream = null;
    }
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stream?.close();
    };
  }, [refetch]);

  if (loading && !data) {
    return <div className="grid gap-3"><Skeleton className="h-6 w-44" /><Skeleton className="h-36 w-full" /></div>;
  }
  if (error && !data) {
    return <div className="border border-rose-300/20 bg-rose-400/8 p-5"><p className="text-sm text-rose-100">{error}</p><Button className="mt-4" variant="secondary" onClick={() => void refetch()}>Try again</Button></div>;
  }

  const matches = data?.matches || [];
  return (
    <div className="grid min-w-0 gap-6">
      <MatchCountdown match={data?.nextMatch || null} serverNow={data?.serverNow || new Date().toISOString()} onReachedZero={() => void refetch()} />
      {showList && matches.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{matches.map((match) => <MatchCard key={match.id} match={match} />)}</div> : null}
    </div>
  );
}
