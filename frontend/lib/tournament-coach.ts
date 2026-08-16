export type CoachDraft = {
  name: string;
  email: string;
  phone: string;
  discord: string;
  gameId: string;
};

export const emptyCoachDraft: CoachDraft = {
  name: "",
  email: "",
  phone: "",
  discord: "",
  gameId: "",
};

const coachFields: Array<keyof CoachDraft> = ["name", "email", "phone", "discord", "gameId"];

export function isCoachEmpty(coach: CoachDraft) {
  return coachFields.every((field) => coach[field].trim() === "");
}

export function getCoachValidationMessage(coach: CoachDraft, coachRequired: boolean, coachSelected?: boolean) {
  if (coachSelected === false) return "";

  if (isCoachEmpty(coach)) {
    return coachRequired ? "A coach is required. Complete all coach details." : coachSelected ? "Complete all coach details." : "";
  }

  if (coachFields.some((field) => coach[field].trim() === "")) {
    return coachRequired
      ? "A coach is required. Complete all coach details."
      : coachSelected ? "Complete all coach details." : "Complete all coach details or leave the coach section empty.";
  }

  return "";
}

export function getCoachPayload(coach: CoachDraft, allowCoach: boolean, coachSelected: boolean) {
  if (!allowCoach || !coachSelected || getCoachValidationMessage(coach, false, true)) return null;

  return Object.fromEntries(coachFields.map((field) => [field, coach[field].trim()])) as CoachDraft;
}
