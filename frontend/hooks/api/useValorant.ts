"use client";

import { useApiQuery } from "@/hooks/api/useApiQuery";
import {
  fetchValorantBindings,
  fetchValorantLeaderboardBans,
  fetchValorantLeaderboardRegistrations,
  fetchValorantLeaderboardRemovals,
  fetchValorantPreview,
  fetchValorantRankings,
  fetchValorantRatingHistory,
  fetchValorantReconciliation,
  fetchValorantSeries,
  fetchValorantSeriesList,
  fetchValorantServerChecks,
  fetchValorantTeamSeries,
} from "@/lib/valorant-api";
import type { ValorantLeaderboardBanStatus, ValorantServerCheckSort } from "@/lib/valorant";

export function useValorantBindings() {
  return useApiQuery(["valorant-bindings"], fetchValorantBindings);
}

export function useValorantLeaderboardRegistrations(query: string, page: number, hidden = false) {
  return useApiQuery(["valorant-leaderboard-registrations", query, page, hidden], () =>
    fetchValorantLeaderboardRegistrations({ query, page, hidden })
  );
}

export function useValorantLeaderboardRemovals(query: string, page: number) {
  return useApiQuery(["valorant-leaderboard-removals", query, page], () =>
    fetchValorantLeaderboardRemovals({ query, page })
  );
}

export function useValorantLeaderboardBans(status: ValorantLeaderboardBanStatus, page: number) {
  return useApiQuery(["valorant-leaderboard-bans", status, page], () =>
    fetchValorantLeaderboardBans({ status, page })
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
