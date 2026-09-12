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
  | "SUBSTITUTE_LIMIT"
  | "INVITES_ACCEPTED"
  | "DISCORD_CONNECTED";

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
  /**
   * Shown, never required. A connected account is what feeds the VALORANT
   * leaderboard and the approval-time snapshot; registration does not wait on
   * it, so a missing one is never a blocker here.
   */
  gameAccount: GameAccount | null;
  /** A Riot ID typed into an older registration. Shown, never trusted. */
  legacyRiotId: string | null;
  ready: boolean;
};

export type RosterReadiness = {
  teamId: string;
  teamName: string;
  tournamentId: string | null;
  /** Which title's game accounts are worth showing — not a requirement. */
  game: string | null;
  discordRequired: boolean;
  ready: boolean;
  requirements: Requirement[];
  members: ReadinessMember[];
};

export const requirementLabel = (requirement: Requirement): string => {
  switch (requirement.type) {
    case "ROSTER_SIZE": {
      // A roster can fail this by being too small OR too large, and the old
      // label only ever read "N of M needed" - which told a captain holding one
      // player too many to go and recruit another. Say which way it is wrong.
      const actual = requirement.actual ?? 0;
      const minimum = requirement.minimum ?? 0;
      const maximum = requirement.maximum;
      if (maximum !== undefined && actual > maximum) {
        const excess = actual - maximum;
        return `Roster size (${actual} active players, maximum ${maximum} — remove ${excess})`;
      }
      return `Roster size (${actual} of ${minimum} active players needed)`;
    }
    case "SUBSTITUTE_LIMIT": {
      const actual = requirement.actual ?? 0;
      const maximum = requirement.maximum ?? 0;
      const excess = actual - maximum;
      return excess > 0
        ? `Substitutes (${actual} of ${maximum} allowed — remove ${excess})`
        : `Substitutes (${actual} of ${maximum} allowed)`;
    }
    case "INVITES_ACCEPTED":
      return "All invitations accepted";
    case "DISCORD_CONNECTED":
      return "Discord connected";
    default:
      return "Requirement";
  }
};

/** What this member still has to do, in words a captain can act on. */
export const memberBlockingReason = (member: ReadinessMember): string | null => {
  if (member.inviteStatus === "declined") return "Declined the invitation";
  if (member.inviteStatus === "pending") return "Invitation not accepted yet";
  if (member.requiresDiscord && !member.hasDiscord) return "Needs to connect Discord";
  // A missing game account is deliberately not a reason. It is worth having —
  // it is what puts a player on the leaderboard — but it never holds up a
  // registration, so it must not appear in a list of things to chase.
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
