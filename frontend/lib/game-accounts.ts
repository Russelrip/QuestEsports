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
  /** Set when this account was just connected; absent when merely listed. */
  leaderboard?: LeaderboardRegistrationResult | null;
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
  /** Held by a Quest player record with no account behind it. Implies linkedElsewhere. */
  unclaimedRecord?: boolean;
  status?: GameAccountStatus;
  verificationStatus?: GameAccountVerification;
  /**
   * Whether this is the account the player's Discord is registered with on the
   * leaderboard, compared by stable identifier on the server. Null when there is
   * nothing to compare with — which is not a mismatch.
   */
  leaderboard?: { matches: boolean; riotId: string | null } | null;
};

export type ValorantPreview = {
  current_tier?: string | null;
  currenttierpatched?: string | null;
  peak_rank?: { tier?: string | null; season?: string | null } | null;
  last_played_match?: string | null;
};

export type GameAccountChangeRequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

/** The player's latest account change: an open one, or a recent decision. */
export type GameAccountChangeRequest = {
  id: string;
  status: GameAccountChangeRequestStatus;
  requestedIdentity: string;
  reason: string;
  adminNote: string | null;
  requestedAt: string;
  reviewedAt: string | null;
};

export type GameAccountList = {
  playerPublicId: string | null;
  accounts: GameAccount[];
  changeRequest?: GameAccountChangeRequest | null;
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
  return unwrap<GameAccountList>(data) ?? { playerPublicId: null, accounts: [], changeRequest: null };
}

/**
 * The one answer to "is my VALORANT account sorted?", shared by the profile
 * header and the panel so the two can never disagree.
 *
 * - `not_connected` — nothing linked yet.
 * - `pending` — a change is waiting for an admin. The current account still
 *   counts until then.
 * - `attention` — something the player should act on or read: an imported
 *   account nobody confirmed, a revoked account, or a change an admin declined.
 * - `connected` — linked and in service, locked by a tournament or not.
 */
export type ValorantConnectionState = "not_connected" | "pending" | "attention" | "connected";

export type ValorantConnectionSummary = {
  state: ValorantConnectionState;
  label: string;
  detail: string;
  riotId: string | null;
};

export function summarizeValorantConnection(
  list: Pick<GameAccountList, "accounts" | "changeRequest"> | null | undefined,
): ValorantConnectionSummary {
  const account = findGameAccount(list?.accounts, "valorant");
  const request = list?.changeRequest ?? null;
  const riotId = gameAccountRiotId(account);

  if (!account) {
    return {
      state: "not_connected",
      label: "Not connected",
      detail: "Connect your Riot ID to join team rosters and the VALORANT leaderboard.",
      riotId: null,
    };
  }

  if (account.status === "revoked" || account.verificationStatus === "revoked") {
    return {
      state: "attention",
      label: "Needs attention",
      detail: "This account was revoked. Contact support to connect an account again.",
      riotId,
    };
  }

  if (request?.status === "pending" || account.status === "change_requested") {
    return {
      state: "pending",
      label: "Change pending",
      detail: request
        ? `Waiting for an admin to approve ${request.requestedIdentity}. ${riotId ?? "Your current account"} stays connected until then.`
        : `Waiting for an admin to review your change. ${riotId ?? "Your current account"} stays connected until then.`,
      riotId,
    };
  }

  if (account.verificationStatus === "legacy_unverified") {
    return {
      state: "attention",
      label: "Needs attention",
      detail: "This account was imported from an older record and nobody has confirmed it is yours.",
      riotId,
    };
  }

  if (request?.status === "rejected") {
    return {
      state: "attention",
      label: "Needs attention",
      detail: `An admin declined your change to ${request.requestedIdentity}. ${riotId ?? "Your account"} is still connected.`,
      riotId,
    };
  }

  return {
    state: "connected",
    label: "Connected",
    detail:
      account.status === "locked"
        ? `${riotId ?? "Your account"} · locked by a tournament roster`
        : `${riotId ?? "Your account"} · ${verificationLabel(account.verificationStatus)}`,
    riotId,
  };
}

/** What the leaderboard holds for the signed-in user's Discord. */
export type LeaderboardRegistrationLookup = {
  discordConnected: boolean;
  /** The leaderboard did not answer — not the same as "not registered". */
  unavailable: boolean;
  registration: {
    riotId: string;
    linkedToYou: boolean;
    linkedElsewhere: boolean;
    unclaimedRecord: boolean;
  } | null;
};

export async function getMyValorantLeaderboardRegistration(): Promise<LeaderboardRegistrationLookup> {
  const { response, data } = await apiFetchJson<{ data?: LeaderboardRegistrationLookup }>(
    "/api/v1/users/me/game-accounts/valorant/leaderboard-registration",
  );
  const message = getApiErrorMessage(response, data, "Could not check the VALORANT leaderboard.");
  if (message) throw new Error(message);
  return (
    unwrap<LeaderboardRegistrationLookup>(data) ?? {
      discordConnected: false,
      unavailable: true,
      registration: null,
    }
  );
}

export async function resolveValorantAccount(riotId: string): Promise<ResolvedGameAccount> {
  const { response, data } = await apiFetchJson<{ data?: ResolvedGameAccount }>(
    "/api/v1/game-accounts/valorant/resolve",
    // `json` rather than a raw `body`: apiFetch only sets the JSON
    // Content-Type when this option is used, and without that header Express
    // never parses the body — the server sees an empty request.
    { method: "POST", json: { riotId } },
  );
  const message = getApiErrorMessage(response, data, "Could not look up that Riot ID.");
  if (message) throw new Error(message);
  const resolved = unwrap<ResolvedGameAccount>(data);
  if (!resolved) throw new Error("Could not look up that Riot ID.");
  return resolved;
}

/**
 * What happened on the VALORANT leaderboard when an account was connected.
 *
 * `diverged` is the one worth showing: their leaderboard entry points at a
 * different account, and the leaderboard has no way to be re-pointed. A stale
 * entry is worse than an absent one — it looks current and is wrong — so the
 * player is told rather than left to discover it in a ranking.
 */
export type LeaderboardRegistrationState =
  | "registered"
  | "already"
  | "diverged"
  | "unavailable";

export type LeaderboardRegistrationResult = {
  state: LeaderboardRegistrationState;
  registeredName?: string | null;
  registeredTag?: string | null;
};

export function leaderboardRegistrationMessage(
  result: LeaderboardRegistrationResult | null | undefined,
): string | null {
  if (!result) return null;
  switch (result.state) {
    case "registered":
      return "You are now on the VALORANT leaderboard.";
    case "diverged": {
      const older =
        result.registeredName && result.registeredTag
          ? `${result.registeredName}#${result.registeredTag}`
          : "a different account";
      return `Your leaderboard entry still points at ${older}. Contact an admin to move it to this account.`;
    }
    case "already":
    case "unavailable":
    default:
      return null;
  }
}

export async function linkValorantAccount(riotId: string): Promise<GameAccount> {
  const { response, data } = await apiFetchJson<{ data?: GameAccount }>(
    "/api/v1/game-accounts/valorant/link",
    // `json` rather than a raw `body`: apiFetch only sets the JSON
    // Content-Type when this option is used, and without that header Express
    // never parses the body — the server sees an empty request.
    { method: "POST", json: { riotId } },
  );
  const message = getApiErrorMessage(response, data, "Could not link that VALORANT account.");
  if (message) throw new Error(message);
  const account = unwrap<GameAccount>(data);
  if (!account) throw new Error("Could not link that VALORANT account.");
  return account;
}

/**
 * Adopt the account this player already registered on the VALORANT leaderboard.
 *
 * That journey asked for the same proof through a longer door: a connected
 * Discord and a PUUID copied from their own Riot account page. Someone who has
 * done it has already told Quest who they are, and asking again — from a
 * display name they now have to remember — is a step that teaches them nothing.
 *
 * The server re-resolves the Riot ID rather than trusting the leaderboard's
 * answer, so this is a shortcut through the same door, not a second one.
 */
export async function importValorantFromLeaderboard(): Promise<GameAccount> {
  const { response, data } = await apiFetchJson<{ data?: GameAccount }>(
    "/api/v1/game-accounts/valorant/import-from-leaderboard",
    { method: "POST", json: {} },
  );
  const message = getApiErrorMessage(
    response,
    data,
    "Could not import your leaderboard account.",
  );
  if (message) throw new Error(message);
  const account = unwrap<GameAccount>(data);
  if (!account) throw new Error("Could not import your leaderboard account.");
  return account;
}

/**
 * The Riot ID a connected account represents, in the `Name#TAG` form every
 * VALORANT surface expects. Null unless both halves are present: half an
 * identifier looks like a value and matches nothing.
 */
export function gameAccountRiotId(account: GameAccount | null | undefined): string | null {
  if (!account?.username || !account?.tagline) return null;
  return `${account.username}#${account.tagline}`;
}

/** The connected account for a game, if this player has one. */
export function findGameAccount(
  accounts: GameAccount[] | null | undefined,
  game: string,
): GameAccount | null {
  const normalized = String(game || "").trim().toLowerCase();
  return (accounts ?? []).find((account) => account.game?.toLowerCase() === normalized) ?? null;
}

/**
 * Asking to move to a different Riot account.
 *
 * A RENAME is not a change: the stable identifier is unchanged, so the server
 * simply refreshes the cached display name and answers `kind: "rename"` with no
 * review. Only a genuinely different account produces a request an admin sees.
 */
export type AccountChangeResult =
  | { kind: "rename"; refreshed: boolean; account: GameAccount }
  | { kind: "replacement"; requestId: string; status: string };

/** Take back a change request nobody has reviewed yet. */
export async function withdrawValorantChange(): Promise<void> {
  const { response, data } = await apiFetchJson<{ data?: unknown }>(
    "/api/v1/game-accounts/valorant/change-request/withdraw",
    { method: "POST", json: {} },
  );
  const message = getApiErrorMessage(response, data, "Could not withdraw your change request.");
  if (message) throw new Error(message);
}

export async function requestValorantChange(
  riotId: string,
  reason: string,
): Promise<AccountChangeResult> {
  const { response, data } = await apiFetchJson<{ data?: AccountChangeResult }>(
    "/api/v1/game-accounts/valorant/change-request",
    { method: "POST", json: { riotId, reason } },
  );
  const message = getApiErrorMessage(response, data, "Could not request an account change.");
  if (message) throw new Error(message);
  const result = unwrap<AccountChangeResult>(data);
  if (!result) throw new Error("Could not request an account change.");
  return result;
}
