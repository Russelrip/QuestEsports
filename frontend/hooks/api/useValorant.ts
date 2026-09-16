"use client";

import { useApiQuery } from "@/hooks/api/useApiQuery";
import {
  fetchValorantBindings,
  fetchValorantLeaderboardRegistrations,
  fetchValorantLeaderboardRemovals,
  fetchValorantMatches,
  fetchValorantPreview,
  fetchValorantRankings,
  fetchValorantRatingHistory,
  fetchValorantReconciliation,
  fetchValorantSeries,
  fetchValorantSeriesList,
  fetchValorantSeriesMatches,
  fetchValorantServerChecks,
  fetchValorantTeamSeries,
} from "@/lib/valorant-api";
import type { ValorantServerCheckSort } from "@/lib/valorant";

export function useValorantBindings() {
  return useApiQuery(["valorant-bindings"], fetchValorantBindings);
}

export function useValorantLeaderboardRegistrations(query: string, page: number) {
  return useApiQuery(["valorant-leaderboard-registrations", query, page], () =>
    fetchValorantLeaderboardRegistrations({ query, page })
  );
}

export function useValorantLeaderboardRemovals(query: string, page: number) {
  return useApiQuery(["valorant-leaderboard-removals", query, page], () =>
    fetchValorantLeaderboardRemovals({ query, page })
  );
}

export function useValorantServerChecks(
  status: "flagged" | "cleared" | "all",
  page: number,
  query = "",
  server = "",
  sort: ValorantServerCheckSort = "default"
) {
  return useApiQuery(["valorant-leaderboard-server-checks", status, page, query, server, sort], () =>
    fetchValorantServerChecks({ status, page, query, server, sort })
  );
}

export function useValorantSeriesList() {
  return useApiQuery(["valorant-series-list"], fetchValorantSeriesList);
}

export function useValorantReconciliation() {
  return useApiQuery(["valorant-reconciliation"], fetchValorantReconciliation);
}

export function useValorantSeriesDetail(seriesId: string) {
  return useApiQuery(["valorant-series", seriesId], () => fetchValorantSeries(seriesId), {
    enabled: Boolean(seriesId),
  });
}

export function useValorantPreview(seriesId: string, enabled: boolean) {
  return useApiQuery(["valorant-preview", seriesId], () => fetchValorantPreview(seriesId), {
    enabled: enabled && Boolean(seriesId),
  });
}

export function useValorantMatches(cursor: string | null, enabled: boolean) {
  return useApiQuery(["valorant-matches", cursor ?? ""], () => fetchValorantMatches({ cursor: cursor ?? undefined, limit: 20 }), {
    enabled,
  });
}

export function useValorantSeriesMatches(seriesId: string, enabled: boolean) {
  return useApiQuery(["valorant-series-matches", seriesId], () => fetchValorantSeriesMatches(seriesId), {
    enabled: enabled && Boolean(seriesId),
  });
}

export function useValorantRankings() {
  return useApiQuery(["valorant-rankings"], fetchValorantRankings);
}

export function useValorantRatingHistory(teamId: string | null, enabled: boolean) {
  return useApiQuery(["valorant-rating-history", teamId ?? ""], () => fetchValorantRatingHistory(teamId as string), {
    enabled: enabled && Boolean(teamId),
  });
}

export function useValorantTeamSeries(teamId: string | null, enabled: boolean) {
  return useApiQuery(["valorant-team-series", teamId ?? ""], () => fetchValorantTeamSeries(teamId as string), {
    enabled: enabled && Boolean(teamId),
  });
}
