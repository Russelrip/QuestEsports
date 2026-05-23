"use client";

import { useApiQuery } from "@/hooks/api/useApiQuery";
import { fetchProfileTeams, fetchTeamInvitePreview } from "@/lib/teams";

export function useTeams(enabled = true) {
  return useApiQuery(["teams", "profile"], fetchProfileTeams, { enabled });
}

export function useTeamInvite(token?: string) {
  return useApiQuery(["team-invite", token ?? ""], () => fetchTeamInvitePreview(token || ""), {
    enabled: Boolean(token),
  });
}
