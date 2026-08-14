"use client";

import { useApiQuery } from "@/hooks/api/useApiQuery";
import {
  fetchValorantBindings,
  fetchValorantMatches,
  fetchValorantPreview,
  fetchValorantRankings,
  fetchValorantRatingHistory,
  fetchValorantReconciliation,
  fetchValorantSeries,
  fetchValorantSeriesList,
  fetchValorantTeamSeries,
} from "@/lib/valorant-api";

export function useValorantBindings() {
  return useApiQuery(["valorant-bindings"], fetchValorantBindings);
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
