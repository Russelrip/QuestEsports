import type { TeamInviteStatus } from "@/lib/teams";

export type RosterDraftMember = {
  key: string;
  id?: string;
  role: "CAPTAIN" | "PLAYER" | "SUBSTITUTE";
  name: string;
  email: string;
  discord: string;
  gameId: string;
};

export type RegistrationCoach = {
  name: string;
  email: string;
  phone: string;
  // Null when the coach had no connected Discord at submission time. It is
  // read-only here either way: the value is resolved from their account, never
  // typed by an admin.
  discord: string | null;
  riotId: string;
};

export const createRosterDraftMember = (
  role: RosterDraftMember["role"],
): RosterDraftMember => ({
  key: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  role,
  name: "",
  email: "",
  discord: "",
  gameId: "",
});

// An invitation nobody has said yes to. Accepted is absent: reopening it would
// unseat someone who already joined.
export const RESENDABLE_INVITE_STATUSES = new Set<string>(["pending", "declined", "expired"]);

// What each coach invitation state means for the registration, so an admin can
// tell why a roster with every player accepted is still not verified.
export const COACH_INVITE_STATUS_HINTS: Record<TeamInviteStatus, string> = {
  pending: "Waiting for the coach to accept. The registration stays unverified until they do.",
  accepted: "The coach accepted from their Quest account.",
  expired: "The coach's invite expired, so the registration cannot verify on its own. The captain can send it again from their team page.",
  declined: "The coach declined, which flags the registration.",
};

// A free tournament never asked for money, so its registrations report "free"
// rather than a payment status that would imply a fee was settled.
export function paymentStatusLabel(registration: {
  paymentStatus: string;
  tournament?: { paymentMethod?: string };
}) {
  return registration.tournament?.paymentMethod === "free"
    ? "free"
    : registration.paymentStatus;
}
