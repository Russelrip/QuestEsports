"use client";

import { useApiQuery } from "@/hooks/api/useApiQuery";
import { fetchProfileTeams } from "@/lib/teams";

export function useTeams(enabled = true) {
  return useApiQuery(["teams", "profile"], fetchProfileTeams, { enabled });
}
