import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";
import {
  TEAM_LOGO_MAX_FILE_SIZE,
  assertFileWithinUploadLimit,
} from "@/lib/upload-limits";

export type SavedTeamMember = {
  id: string;
  role: "CAPTAIN" | "PLAYER" | "SUBSTITUTE" | "COACH";
  memberOrder: number;
  name: string;
  email: string;
  discord?: string | null;
  riotId?: string | null;
  inviteStatus: "pending" | "accepted" | "declined";
  inviteSentAt?: string | null;
  inviteRespondedAt?: string | null;
};

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
  captainName: string;
  createdAt: string;
  updatedAt: string;
  members: SavedTeamMember[];
};

export type TeamInvitePreview = {
  memberName: string;
  email: string;
  inviteStatus: "pending" | "accepted" | "declined";
  registrationId: string | null;
  team: {
    id: string;
    name: string;
    captainName: string;
    tournamentTitle: string | null;
  };
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
  name: string;
  email: string;
};

export type ManageTeamMemberInput = CreateTeamMemberInput & {
  role: "PLAYER" | "SUBSTITUTE" | "COACH";
  discord?: string;
  riotId?: string;
};

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

export async function resendSavedTeamInvite(teamId: string, memberId: string) {
  const { response, data } = await apiFetchJson<{
    success?: boolean;
    message?: string;
    details?: { retryAfterSeconds?: number };
    member?: SavedTeamMember;
    resendAvailableAt?: string;
  }>(`/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(memberId)}/resend-invite`, {
    method: "POST",
  });
  const errorMessage = getApiErrorMessage(response, data, "Could not resend this invitation.");
  if (errorMessage || !data.member) {
    const error = new Error(errorMessage || "Could not resend this invitation.") as Error & {
      retryAfterSeconds?: number;
    };
    error.retryAfterSeconds = data.details?.retryAfterSeconds;
    throw error;
  }
  return {
    member: data.member,
    resendAvailableAt: data.resendAvailableAt || null,
    message: data.message || "A new team invitation has been sent.",
  };
}

export async function fetchTeamInvitePreview(token: string) {
  const { response, data } = await apiFetchJson<{
    success?: boolean;
    message?: string;
    invite?: TeamInvitePreview;
  }>(`/api/team-invite?token=${encodeURIComponent(token)}`);

  const errorMessage = getApiErrorMessage(
    response,
    data,
    "Could not load this team invite."
  );

  if (errorMessage || !data.invite) {
    throw new Error(errorMessage || "Could not load this team invite.");
  }

  return data.invite;
}

export async function respondToTeamInvite(token: string, decision: "accept" | "decline") {
  const { response, data } = await apiFetchJson<{
    success?: boolean;
    message?: string;
    invite?: TeamInvitePreview;
  }>("/api/team-invite/respond", {
    method: "POST",
    json: {
      token,
      decision,
    },
  });

  const errorMessage = getApiErrorMessage(
    response,
    data,
    "Could not update this team invite."
  );

  if (errorMessage || !data.invite) {
    throw new Error(errorMessage || "Could not update this team invite.");
  }

  return {
    invite: data.invite,
    message: data.message || "",
  };
}
