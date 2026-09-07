"use client";

import { useApiQuery } from "@/hooks/api/useApiQuery";
import { fetchMyInvitations, fetchProfileTeams } from "@/lib/teams";

export function useTeams(enabled = true) {
  return useApiQuery(["teams", "profile"], fetchProfileTeams, { enabled });
}

// Addressed to the signed-in user, so there is nothing to key it by. The token
// this used to take no longer authorizes anything: an invitation is answered by
// the identity of whoever signs in to claim it.
export function useMyInvitations(enabled = true) {
  return useApiQuery(["invitations", "mine"], fetchMyInvitations, { enabled });
}
