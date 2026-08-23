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
