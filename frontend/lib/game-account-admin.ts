import { adminRequest } from "@/lib/admin";

export type ChangeRequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

export type GameAccountChangeRequest = {
  id: string;
  status: ChangeRequestStatus;
  game: string;
  reason: string;
  /** `Name#Tag` the player wants to move to. */
  requestedIdentity: string;
  requestedRegion: string | null;
  /** `Name#Tag` currently on the account, or null if it has since been removed. */
  currentIdentity: string | null;
  player: { publicId: string; displayName: string } | null;
  requestedAt: string;
  reviewedAt: string | null;
  adminNote: string | null;
};

type ListEnvelope = { data?: { requests?: GameAccountChangeRequest[] } };
type ReviewEnvelope = { data?: { status: ChangeRequestStatus; gameAccountId: string | null } };

export async function listChangeRequests(
  status: ChangeRequestStatus | "all" = "pending",
): Promise<GameAccountChangeRequest[]> {
  const result = await adminRequest<ListEnvelope>(
    `/api/v1/admin/game-accounts/change-requests?status=${encodeURIComponent(status)}`,
  );
  return result?.data?.requests ?? [];
}

export async function reviewChangeRequest(input: {
  requestId: string;
  approve: boolean;
  adminNote: string;
}): Promise<{ status: ChangeRequestStatus; gameAccountId: string | null }> {
  const result = await adminRequest<ReviewEnvelope>(
    `/api/v1/admin/game-accounts/change-requests/${encodeURIComponent(input.requestId)}/review`,
    {
      method: "POST",
      // `json` rather than a raw body: apiFetch only sets the JSON
      // Content-Type for this option, and without it the server never parses
      // the request.
      json: { approve: input.approve, adminNote: input.adminNote },
    },
  );
  return result?.data ?? { status: "pending", gameAccountId: null };
}

/** A linked account as staff see it — including who holds it, which no player is ever told. */
export type AdminGameAccount = {
  id: string;
  game: string;
  /** `Name#Tag`, or null for a row whose display snapshot was never filled in. */
  riotId: string | null;
  region: string | null;
  status: "active" | "change_requested" | "locked" | "replaced" | "revoked";
  verificationStatus: string;
  linkedAt: string;
  /** Short hash of the stable identifier — enough to match this row to an audit entry. */
  externalIdFingerprint: string;
  player: {
    publicId: string | null;
    displayName: string | null;
    /** False for an older player record nobody can sign in as — staff are the only route. */
    hasQuestAccount: boolean;
    username: string | null;
    discord: { username: string | null; globalName: string | null } | null;
  };
  /** Approved rosters pointing at this row. Their own snapshots survive an unlink. */
  registrationSnapshots: number;
  locked: boolean;
};

export type UnlinkResult = {
  released: {
    riotId: string | null;
    externalIdFingerprint: string;
    previousHolder: AdminGameAccount["player"];
    registrationSnapshots: number;
    wasLocked: boolean;
  };
  changeRequestsClosed: number;
  rankingsCleared: number;
  leaderboard:
    | { state: "removed"; removalId: string | null }
    | { state: "failed"; reason: string | null }
    | { state: "not_permitted" }
    | null;
};

type SearchEnvelope = { data?: { accounts?: AdminGameAccount[] } };
type UnlinkEnvelope = { data?: UnlinkResult };

export async function searchGameAccounts(query: string): Promise<AdminGameAccount[]> {
  const result = await adminRequest<SearchEnvelope>(
    `/api/v1/admin/game-accounts?q=${encodeURIComponent(query)}`,
  );
  return result?.data?.accounts ?? [];
}

export async function unlinkGameAccount(input: {
  accountId: string;
  reason: string;
  /** The identity the admin was looking at; a row that has since changed refuses. */
  expectedRiotId: string | null;
  allowLocked: boolean;
  releaseLeaderboard: boolean;
}): Promise<UnlinkResult> {
  const result = await adminRequest<UnlinkEnvelope>(
    `/api/v1/admin/game-accounts/${encodeURIComponent(input.accountId)}/unlink`,
    {
      method: "POST",
      json: {
        reason: input.reason,
        expectedRiotId: input.expectedRiotId,
        allowLocked: input.allowLocked,
        releaseLeaderboard: input.releaseLeaderboard,
      },
    },
  );
  if (!result?.data) throw new Error("The unlink did not return a result.");
  return result.data;
}

export const accountStatusLabel = (status: AdminGameAccount["status"]): string => {
  switch (status) {
    case "active":
      return "Active";
    case "change_requested":
      return "Change pending";
    case "locked":
      return "Locked to a roster";
    case "replaced":
      return "Replaced";
    case "revoked":
      return "Revoked";
    default:
      return "Unknown";
  }
};

export const statusLabel = (status: ChangeRequestStatus): string => {
  switch (status) {
    case "pending":
      return "Awaiting review";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "withdrawn":
      return "Withdrawn";
    default:
      return "Unknown";
  }
};
