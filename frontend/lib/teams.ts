import { apiFetchJson, getApiErrorMessage } from "@/lib/auth";
import type { TournamentRegistrationFormData } from "@/lib/tournament-registration";

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
  logoName?: string | null;
  createdAt: string;
  updatedAt: string;
  members: SavedTeamMember[];
};

export type TeamInvitePreview = {
  memberName: string;
  email: string;
  inviteStatus: "pending" | "accepted" | "declined";
  team: {
    id: string;
    name: string;
    captainName: string;
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

const getMemberByRole = (
  team: SavedTeam,
  role: SavedTeamMember["role"],
  memberOrder: number
) =>
  team.members.find(
    (member) => member.role === role && member.memberOrder === memberOrder
  );

export const applySavedTeamToRegistrationForm = (
  team: SavedTeam,
  current: TournamentRegistrationFormData
): TournamentRegistrationFormData => {
  const next = {
    ...current,
    teamName: team.name,
  };

  const player2 = getMemberByRole(team, "PLAYER", 1);
  const player3 = getMemberByRole(team, "PLAYER", 2);
  const player4 = getMemberByRole(team, "PLAYER", 3);
  const player5 = getMemberByRole(team, "PLAYER", 4);
  const sub1 = getMemberByRole(team, "SUBSTITUTE", 1);
  const sub2 = getMemberByRole(team, "SUBSTITUTE", 2);
  const coach = getMemberByRole(team, "COACH", 1);

  return {
    ...next,
    player2Name: player2?.name || "",
    player2Email: player2?.email || "",
    player2Discord: player2?.discord || "",
    player2RiotId: player2?.riotId || "",
    player3Name: player3?.name || "",
    player3Email: player3?.email || "",
    player3Discord: player3?.discord || "",
    player3RiotId: player3?.riotId || "",
    player4Name: player4?.name || "",
    player4Email: player4?.email || "",
    player4Discord: player4?.discord || "",
    player4RiotId: player4?.riotId || "",
    player5Name: player5?.name || "",
    player5Email: player5?.email || "",
    player5Discord: player5?.discord || "",
    player5RiotId: player5?.riotId || "",
    sub1Name: sub1?.name || "",
    sub1Email: sub1?.email || "",
    sub1Discord: sub1?.discord || "",
    sub1RiotId: sub1?.riotId || "",
    sub2Name: sub2?.name || "",
    sub2Email: sub2?.email || "",
    sub2Discord: sub2?.discord || "",
    sub2RiotId: sub2?.riotId || "",
    coachName: coach?.name || "",
    coachEmail: coach?.email || "",
    coachDiscord: coach?.discord || "",
    coachRiotId: coach?.riotId || "",
  };
};
