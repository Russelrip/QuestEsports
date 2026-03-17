export type TournamentRegistrationFormData = {
  tournament: string;
  teamName: string;
  teamLogo: File | null;
  captainName: string;
  captainEmail: string;
  captainPhone: string;
  captainDiscord: string;
  captainRiotId: string;
  player2Name: string;
  player2Discord: string;
  player2RiotId: string;
  player3Name: string;
  player3Discord: string;
  player3RiotId: string;
  player4Name: string;
  player4Discord: string;
  player4RiotId: string;
  player5Name: string;
  player5Discord: string;
  player5RiotId: string;
  sub1Name: string;
  sub1Discord: string;
  sub1RiotId: string;
  sub2Name: string;
  sub2Discord: string;
  sub2RiotId: string;
  coachName: string;
  coachDiscord: string;
  coachRiotId: string;
  contactEmail: string;
  rulebook: boolean;
  falsityWarning: boolean;
};

export const initialTournamentRegistrationFormData: TournamentRegistrationFormData = {
  tournament: "",
  teamName: "",
  teamLogo: null,
  captainName: "",
  captainEmail: "",
  captainPhone: "",
  captainDiscord: "",
  captainRiotId: "",
  player2Name: "",
  player2Discord: "",
  player2RiotId: "",
  player3Name: "",
  player3Discord: "",
  player3RiotId: "",
  player4Name: "",
  player4Discord: "",
  player4RiotId: "",
  player5Name: "",
  player5Discord: "",
  player5RiotId: "",
  sub1Name: "",
  sub1Discord: "",
  sub1RiotId: "",
  sub2Name: "",
  sub2Discord: "",
  sub2RiotId: "",
  coachName: "",
  coachDiscord: "",
  coachRiotId: "",
  contactEmail: "",
  rulebook: false,
  falsityWarning: false,
};

export type MemberFieldGroup = {
  key: "player2" | "player3" | "player4" | "player5" | "sub1" | "sub2";
  title: string;
  required: boolean;
};

export const requiredPlayerGroups: MemberFieldGroup[] = [
  { key: "player2", title: "Player 2", required: true },
  { key: "player3", title: "Player 3", required: true },
  { key: "player4", title: "Player 4", required: true },
  { key: "player5", title: "Player 5", required: true },
];

export const substitutePlayerGroups: MemberFieldGroup[] = [
  { key: "sub1", title: "Substitute Player 1", required: false },
  { key: "sub2", title: "Substitute Player 2", required: false },
];

export const appendTournamentRegistrationFormData = (
  formData: TournamentRegistrationFormData
) => {
  const submitData = new FormData();

  Object.entries(formData).forEach(([key, value]) => {
    if (value === null || value === "") {
      return;
    }

    if (value instanceof File) {
      submitData.append(key, value);
      return;
    }

    submitData.append(key, String(value));
  });

  if (formData.tournament) {
    submitData.append("tournamentSlug", formData.tournament);
  }

  return submitData;
};
