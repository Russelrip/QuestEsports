import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";

export type GameAccountGame = "valorant";

/**
 * What Quest actually established about a linked account, in increasing order
 * of strength. There is deliberately no "ownership verified": the VALORANT
 * upstream resolves accounts through HenrikDev, which proves an account exists
 * but can never prove the signed-in user holds it. Labels below must never
 * overstate these.
 */
export type GameAccountVerification =
  | "resolved"
  | "user_confirmed"
  | "discord_corroborated"
  | "admin_verified"
  | "legacy_unverified"
  | "revoked";

export type GameAccountStatus = "active" | "change_requested" | "locked" | "replaced" | "revoked";

export type GameAccount = {
  id: string;
  game: GameAccountGame;
  username: string | null;
  tagline: string | null;
  region: string | null;
  verificationStatus: GameAccountVerification;
  status: GameAccountStatus;
  linkedAt: string | null;
  verifiedAt: string | null;
  lastSyncedAt: string | null;
};

export type ResolvedGameAccount = {
  game: GameAccountGame;
  username: string | null;
  tagline: string | null;
  region: string | null;
  verification: "resolved";
  preview: ValorantPreview | null;
  available: boolean;
  linkedToYou: boolean;
  linkedElsewhere: boolean;
  status?: GameAccountStatus;
  verificationStatus?: GameAccountVerification;
};

export type ValorantPreview = {
  current_tier?: string | null;
  currenttierpatched?: string | null;
  peak_rank?: { tier?: string | null; season?: string | null } | null;
  last_played_match?: string | null;
};

export type GameAccountList = {
  playerPublicId: string | null;
  accounts: GameAccount[];
};

/**
 * Wording is a correctness concern here, not copywriting. Calling a
 * self-asserted link "verified" would tell a captain something Quest never
 * checked, so each state says exactly what happened.
 */
export const verificationLabel = (status: GameAccountVerification): string => {
  switch (status) {
    case "resolved":
      return "Found, not confirmed";
    case "user_confirmed":
      return "Confirmed by you";
    case "discord_corroborated":
      return "Confirmed, matches your Discord";
    case "admin_verified":
      return "Verified by an admin";
    case "legacy_unverified":
      return "Imported — needs confirming";
    case "revoked":
      return "Revoked";
    default:
      return "Unknown";
  }
};

export const statusLabel = (status: GameAccountStatus): string => {
  switch (status) {
    case "active":
      return "Connected";
    case "change_requested":
      return "Change pending";
    case "locked":
      return "Locked by a tournament";
    case "replaced":
      return "Replaced";
    case "revoked":
      return "Revoked";
    default:
      return "Unknown";
  }
};

const unwrap = <T>(data: { data?: T }): T | null => (data?.data as T) ?? null;

export async function getMyGameAccounts(): Promise<GameAccountList> {
  const { response, data } = await apiFetchJson<{ data?: GameAccountList }>(
    "/api/v1/users/me/game-accounts",
  );
  const message = getApiErrorMessage(response, data, "Could not load your game accounts.");
  if (message) throw new Error(message);
  return unwrap<GameAccountList>(data) ?? { playerPublicId: null, accounts: [] };
}

export async function resolveValorantAccount(riotId: string): Promise<ResolvedGameAccount> {
  const { response, data } = await apiFetchJson<{ data?: ResolvedGameAccount }>(
    "/api/v1/game-accounts/valorant/resolve",
    { method: "POST", body: JSON.stringify({ riotId }) },
  );
  const message = getApiErrorMessage(response, data, "Could not look up that Riot ID.");
  if (message) throw new Error(message);
  const resolved = unwrap<ResolvedGameAccount>(data);
  if (!resolved) throw new Error("Could not look up that Riot ID.");
  return resolved;
}

export async function linkValorantAccount(riotId: string): Promise<GameAccount> {
  const { response, data } = await apiFetchJson<{ data?: GameAccount }>(
    "/api/v1/game-accounts/valorant/link",
    { method: "POST", body: JSON.stringify({ riotId }) },
  );
  const message = getApiErrorMessage(response, data, "Could not link that VALORANT account.");
  if (message) throw new Error(message);
  const account = unwrap<GameAccount>(data);
  if (!account) throw new Error("Could not link that VALORANT account.");
  return account;
}
