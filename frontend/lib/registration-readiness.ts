import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";
import type { GameAccount } from "@/lib/game-accounts";

/**
 * Roster readiness is computed on the server and rendered here as-is. Do not
 * re-derive `ready` in the browser: duplicating the rules is what produced the
 * two-sources-of-truth registration status bug, and the server is the only
 * authority that also blocks the submit.
 */
export type RequirementType =
  | "ROSTER_SIZE"
  | "INVITES_ACCEPTED"
  | "DISCORD_CONNECTED"
  | "PLAYER_GAME_ACCOUNTS";

export type Requirement = {
  type: RequirementType;
  status: "PASS" | "FAIL";
  /** Member ids blocking this requirement, when the requirement tracks people. */
  members?: string[];
  minimum?: number;
  maximum?: number;
  actual?: number;
  game?: string;
};

export type ReadinessMember = {
  id: string;
  name: string;
  role: "CAPTAIN" | "PLAYER" | "SUBSTITUTE" | "COACH";
  memberOrder: number;
  inviteStatus: "pending" | "accepted" | "declined";
  hasQuestAccount: boolean;
  hasDiscord: boolean;
  requiresDiscord: boolean;
  gameAccount: GameAccount | null;
  /** A Riot ID typed into an older registration. Shown, never trusted. */
  legacyRiotId: string | null;
  requiresGameAccount: boolean;
  ready: boolean;
};

export type RosterReadiness = {
  teamId: string;
  teamName: string;
  tournamentId: string | null;
  requiredGame: string | null;
  discordRequired: boolean;
  ready: boolean;
  requirements: Requirement[];
  members: ReadinessMember[];
};

export const requirementLabel = (requirement: Requirement): string => {
  switch (requirement.type) {
    case "ROSTER_SIZE":
      return `Roster size (${requirement.actual ?? 0} of ${requirement.minimum ?? 0} needed)`;
    case "INVITES_ACCEPTED":
      return "All invitations accepted";
    case "DISCORD_CONNECTED":
      return "Discord connected";
    case "PLAYER_GAME_ACCOUNTS":
      return "Game accounts connected";
    default:
      return "Requirement";
  }
};

/** What this member still has to do, in words a captain can act on. */
export const memberBlockingReason = (member: ReadinessMember): string | null => {
  if (member.inviteStatus === "declined") return "Declined the invitation";
  if (member.inviteStatus === "pending") return "Invitation not accepted yet";
  if (member.requiresDiscord && !member.hasDiscord) return "Needs to connect Discord";
  if (member.requiresGameAccount && !member.gameAccount) {
    // Being explicit matters here: a captain looking at a filled-in Riot ID
    // from a previous event will otherwise think this is a bug.
    return member.legacyRiotId
      ? "Riot ID was typed by hand and never verified — needs connecting"
      : "Needs to connect their game account";
  }
  return null;
};

export async function fetchRosterReadiness(
  teamId: string,
  tournamentId?: string,
): Promise<RosterReadiness> {
  const query = tournamentId ? `?tournamentId=${encodeURIComponent(tournamentId)}` : "";
  const { response, data } = await apiFetchJson<{ data?: RosterReadiness }>(
    `/api/v1/teams/${encodeURIComponent(teamId)}/registration-readiness${query}`,
  );
  const message = getApiErrorMessage(response, data, "Could not check roster readiness.");
  if (message) throw new Error(message);
  const readiness = (data?.data as RosterReadiness) ?? null;
  if (!readiness) throw new Error("Could not check roster readiness.");
  return readiness;
}
