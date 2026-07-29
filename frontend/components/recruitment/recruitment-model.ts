export type ApplicationType =
  | "solo_player"
  | "existing_team"
  | "incomplete_team";

export type RecruitmentMember = {
  name: string;
  ign: string;
  nic: string;
  discord: string;
  email: string;
  phone: string;
  role: "player" | "substitute";
  privacyAccepted: boolean;
};

export type RecruitmentMemberTextField = Exclude<
  keyof RecruitmentMember,
  "privacyAccepted"
>;

export type RecruitmentFields = {
  applicationType: ApplicationType;
  fullName: string;
  ign: string;
  birthday: string;
  gender: string;
  phone: string;
  discord: string;
  games: string[];
  otherGame: string;
  peakAndCurrentRank: string;
  nic: string;
  tournamentExperience: string;
  previouslyInOrganization: boolean;
  previousOrganization: string;
  canAttendLan: boolean;
  teamName: string;
  teamLogoUrl: string;
  currentRosterSize: string;
  additionalMembers: string;
  notes: string;
  declarationAccepted: boolean;
  privacyAccepted: boolean;
};

export const recruitmentGames = [
  "VALORANT",
  "Mobile Legends: Bang Bang",
  "PUBG Mobile",
  "League of Legends",
  "Counter-Strike 2",
  "Dota 2",
  "Apex Legends",
  "Call of Duty Mobile",
  "Free Fire",
];

export const recruitmentRules = [
  "Respect all players, staff members, and community members.",
  "Toxic behavior, harassment, discrimination, or hate speech will not be tolerated.",
  "Maintain good sportsmanship during tournaments and community activities.",
  "Cheating, exploiting bugs, account sharing, and unauthorized software are prohibited.",
  "Follow tournament rules and team management decisions.",
  "Represent Quest E-sports professionally online and offline.",
  "Attend scheduled practices, meetings, and official events whenever possible.",
];

export const createEmptyRecruitmentMember = (): RecruitmentMember => ({
  name: "",
  ign: "",
  nic: "",
  discord: "",
  email: "",
  phone: "",
  role: "player",
  privacyAccepted: false,
});

export const initialRecruitmentFields: RecruitmentFields = {
  applicationType: "solo_player",
  fullName: "",
  ign: "",
  birthday: "",
  gender: "",
  phone: "",
  discord: "",
  games: [],
  otherGame: "",
  peakAndCurrentRank: "",
  nic: "",
  tournamentExperience: "",
  previouslyInOrganization: false,
  previousOrganization: "",
  canAttendLan: false,
  teamName: "",
  teamLogoUrl: "",
  currentRosterSize: "",
  additionalMembers: "",
  notes: "",
  declarationAccepted: false,
  privacyAccepted: false,
};
