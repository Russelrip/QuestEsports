import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";
import {
  TEAM_LOGO_MAX_FILE_SIZE,
  assertFileWithinUploadLimit,
} from "@/lib/upload-limits";
import { emptyCoachDraft, type CoachDraft } from "@/lib/tournament-coach";

// `expired` is a state now rather than the absence of a usable token: an
// invitation is answered by the invitee's identity, so nothing disappears when
// the deadline passes unless it is written down.
export type TeamInviteStatus = "pending" | "accepted" | "declined" | "expired";

export type SavedTeamMember = {
  id: string;
  role: "CAPTAIN" | "PLAYER" | "SUBSTITUTE" | "COACH";
  memberOrder: number;
  name: string;
  email: string;
  phone?: string | null;
  discord?: string | null;
  riotId?: string | null;
  inviteStatus: TeamInviteStatus;
  inviteSentAt?: string | null;
  inviteRespondedAt?: string | null;
  // Why this roster is not confirming yet. A captain can otherwise only see
  // that somebody has not accepted, not that they have no Quest account or have
  // never connected Discord and so cannot accept even if they wanted to.
  hasQuestAccount?: boolean;
  hasDiscord?: boolean;
};

// Mirrors MemberDraft in the registration form: no `discord`, because a roster
// member's handle comes from their own connected account rather than from
// whatever a captain saved on a previous team.
export type SavedTeamRegistrationMemberDraft = {
  name: string;
  email: string;
  gameId: string;
  role: "PLAYER" | "SUBSTITUTE";
  additionalData: Record<string, string | boolean>;
};

export function mapSavedTeamToRegistrationDraft(
  team: Pick<SavedTeam, "members">,
  omittedMemberId?: string
): {
  members: SavedTeamRegistrationMemberDraft[];
  coach: CoachDraft;
  coachSelected: boolean;
} {
  const savedCoach = team.members.find((member) => member.role === "COACH");

  return {
    members: team.members
      .filter((member) => member.id !== omittedMemberId && member.role !== "CAPTAIN" && member.role !== "COACH")
      .map((member) => ({
        name: member.name,
        email: member.email,
        gameId: member.riotId || "",
        role: member.role === "SUBSTITUTE" ? "SUBSTITUTE" : "PLAYER",
        additionalData: {},
      })),
    coach: savedCoach ? {
      name: savedCoach.name,
      email: savedCoach.email,
      phone: savedCoach.phone || "",
      gameId: savedCoach.riotId || "",
    } : { ...emptyCoachDraft },
    coachSelected: Boolean(savedCoach),
  };
}

export type SavedTeam = {
  id: string;
  name: string;
  country?: string | null;
  teamTag?: string | null;
  organizationRequested?: boolean;
  organizationName: string;
  logoName?: string | null;
  logoUrl?: string | null;
  isCaptain: boolean;
  registrationCount: number;
  canDelete: boolean;
  captainName: string;
  createdAt: string;
  updatedAt: string;
  members: SavedTeamMember[];
};

export type TeamInvitation = {
  id: string;
  role: "CAPTAIN" | "PLAYER" | "SUBSTITUTE" | "COACH";
  teamId: string;
  teamName: string;
  teamTag: string | null;
  game: string | null;
  captain: string | null;
  tournamentTitle: string | null;
  tournamentSlug: string | null;
  sentAt: string | null;
  expiresAt: string | null;
};

// What is standing between this account and accepting. Reported alongside the
// invitations so the page can offer the fix instead of only refusing.
export type InvitationReadiness = {
  hasQuestAccount: boolean;
  hasDiscord: boolean;
};

// What a nudge actually reached. A captain deciding whether to go and message
// someone needs to know that nothing did, not a reassuring "invitation sent".
export type InviteDelivery = {
  inApp: boolean;
  discord: boolean;
  discordReason: string | null;
  hasQuestAccount: boolean;
  invitationUrl?: string;
};

export async function fetchProfileTeams() {
  const { response, data } = await apiFetchJson<{
    success?: boolean;
    message?: string;
    teams?: SavedTeam[];
  }>("/api/teams/profile");

  const errorMessage = getApiErrorMessage(
    response,
    data,
    "Could not load your saved teams."
  );

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return data.teams || [];
}

export type CreateTeamMemberInput = {
  role: "PLAYER" | "SUBSTITUTE" | "COACH";
  name: string;
  email: string;
  phone?: string;
  discord?: string;
  riotId?: string;
};

export type ManageTeamMemberInput = CreateTeamMemberInput;

export async function createSavedTeam(input: {
  name: string;
  country: string;
  teamTag: string;
  organizationRequested: boolean;
  teamLogo: File | null;
  members: CreateTeamMemberInput[];
}) {
  assertFileWithinUploadLimit(
    input.teamLogo,
    TEAM_LOGO_MAX_FILE_SIZE,
    "Team logo"
  );

  const body = new FormData();
  body.append("name", input.name);
  body.append("country", input.country);
  body.append("teamTag", input.teamTag);
  body.append("organizationRequested", String(input.organizationRequested));
  body.append("members", JSON.stringify(input.members));
  if (input.teamLogo) {
    body.append("teamLogo", input.teamLogo);
  }

  const { response, data } = await apiFetchJson<{
    success?: boolean;
    message?: string;
    team?: SavedTeam;
  }>("/api/teams", { method: "POST", body });
  const errorMessage = getApiErrorMessage(
    response,
    data,
    "Could not create this team."
  );

  if (errorMessage || !data.team) {
    throw new Error(errorMessage || "Could not create this team.");
  }

  return {
    team: data.team,
    message: data.message || "Team created successfully.",
  };
}

export async function updateSavedTeam(input: {
  teamId: string;
  name: string;
  country: string;
  teamTag: string;
  organizationRequested: boolean;
  teamLogo: File | null;
  removeLogo: boolean;
  members: ManageTeamMemberInput[];
}) {
  assertFileWithinUploadLimit(input.teamLogo, TEAM_LOGO_MAX_FILE_SIZE, "Team logo");
  const body = new FormData();
  body.append("name", input.name);
  body.append("country", input.country);
  body.append("teamTag", input.teamTag);
  body.append("organizationRequested", String(input.organizationRequested));
  body.append("removeLogo", String(input.removeLogo));
  body.append("members", JSON.stringify(input.members));
  if (input.teamLogo) body.append("teamLogo", input.teamLogo);

  const { response, data } = await apiFetchJson<{
    success?: boolean;
    message?: string;
    team?: SavedTeam;
  }>(`/api/teams/${encodeURIComponent(input.teamId)}`, { method: "PATCH", body });
  const errorMessage = getApiErrorMessage(response, data, "Could not update this team.");
  if (errorMessage || !data.team) {
    throw new Error(errorMessage || "Could not update this team.");
  }
  return { team: data.team, message: data.message || "Team updated successfully." };
}

export async function deleteSavedTeam(teamId: string) {
  const { response, data } = await apiFetchJson<{
    success?: boolean;
    message?: string;
  }>(`/api/teams/${encodeURIComponent(teamId)}`, { method: "DELETE" });
  const errorMessage = getApiErrorMessage(response, data, "Could not delete this team.");
  if (errorMessage) throw new Error(errorMessage);
  return data.message || "Team deleted successfully.";
}

export async function nudgeTeamInvite(teamId: string, memberId: string) {
  const { response, data } = await apiFetchJson<{
    success?: boolean;
    message?: string;
    details?: { retryAfterSeconds?: number };
    member?: SavedTeamMember;
    delivery?: InviteDelivery;
    resendAvailableAt?: string;
  }>(`/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberId)}/nudge`, {
    method: "POST",
  });
  const errorMessage = getApiErrorMessage(response, data, "Could not send this reminder.");
  if (errorMessage || !data.member) {
    const error = new Error(errorMessage || "Could not send this reminder.") as Error & {
      retryAfterSeconds?: number;
    };
    error.retryAfterSeconds = data.details?.retryAfterSeconds;
    throw error;
  }
  return {
    member: data.member,
    delivery: data.delivery || null,
    resendAvailableAt: data.resendAvailableAt || null,
    message: data.message || "Reminder sent.",
  };
}

export async function fetchMyInvitations() {
  const { response, data } = await apiFetchJson<{
    success?: boolean;
    message?: string;
    invitations?: TeamInvitation[];
    readiness?: InvitationReadiness;
  }>("/api/me/invitations");
  const errorMessage = getApiErrorMessage(response, data, "Could not load your invitations.");
  if (errorMessage) throw new Error(errorMessage);
  return {
    invitations: data.invitations || [],
    readiness: data.readiness || { hasQuestAccount: true, hasDiscord: false },
  };
}

export async function respondToInvitation(invitationId: string, decision: "accept" | "decline") {
  const { response, data } = await apiFetchJson<{
    success?: boolean;
    message?: string;
    code?: string;
    inviteStatus?: "accepted" | "declined";
  }>(`/api/me/invitations/${encodeURIComponent(invitationId)}/respond`, {
    method: "POST",
    json: { decision },
  });
  const errorMessage = getApiErrorMessage(response, data, "Could not answer this invitation.");
  if (errorMessage) {
    const error = new Error(errorMessage) as Error & { code?: string };
    // The one refusal the page can do something about: offer the connect flow
    // rather than only reporting that accepting failed.
    error.code = data.code;
    throw error;
  }
  return {
    inviteStatus: data.inviteStatus || "accepted",
    message: data.message || "Invitation answered.",
  };
}
