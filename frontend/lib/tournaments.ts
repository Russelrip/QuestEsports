import { fetchApiJson } from "@/lib/api";

export type TournamentStatus =
  | "draft"
  | "upcoming"
  | "registration_open"
  | "ongoing"
  | "completed"
  | "cancelled";

export type TournamentRegistrationState =
  | "registration_open"
  | "registration_closed"
  | "slots_full";

export type TournamentScheduleData = {
  sheetName: string;
  headers: string[];
  rows: Record<string, string>[];
};

export type TournamentShowcase = {
  posterUrl: string | null;
  firstPlaceUrl: string | null;
  secondPlaceUrl: string | null;
  thirdPlaceUrl: string | null;
};

export type RegisteredTournamentTeam = {
  id: string;
  teamName: string;
  logoUrl: string | null;
  shortCode: string;
  memberCount: number;
  status: string;
};

export type BracketParticipant = {
  id: number;
  tournament_id: number;
  name: string;
  registrationId?: string;
  shortCode?: string;
  logoUrl?: string | null;
  seed?: number;
};

export type BracketOpponent = {
  id: number | null;
  position?: number;
  score?: number;
  result?: "win" | "loss" | "draw";
};

export type BracketStage = {
  id: number;
  name: string;
  type: string;
};

export type BracketGroup = {
  id: number;
  stage_id: number;
  number: number;
};

export type BracketRound = {
  id: number;
  stage_id: number;
  group_id: number;
  number: number;
};

export type BracketMatch = {
  id: number;
  number: number;
  stage_id: number;
  group_id: number;
  round_id: number;
  child_count: number;
  status: number;
  opponent1: BracketOpponent | null;
  opponent2: BracketOpponent | null;
};

export type TournamentBracketData = {
  participant: BracketParticipant[];
  stage: BracketStage[];
  group: BracketGroup[];
  round: BracketRound[];
  match: BracketMatch[];
  match_game: unknown[];
};

export type TournamentBracketSummary = {
  total: number;
  completed: number;
  live: number;
  paused: number;
  pending: number;
  lastUpdatedAt?: string | null;
};

export type Tournament = {
  id: string;
  slug: string;
  title: string;
  game: string;
  displayPriority: number;
  bannerUrl: string | null;
  shortDescription: string;
  fullDescription: string;
  rules: string | null;
  registrationOpenAt: string | null;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  format: string;
  teamSize: number;
  maxTeams: number;
  registrationCount: number;
  prizePool: string;
  status: TournamentStatus;
  isPublished: boolean;
  bracketLink: string | null;
  contactLink: string | null;
  isFeatured: boolean;
  scheduleData: TournamentScheduleData | null;
  bracketSummary: TournamentBracketSummary | null;
  bracketData: TournamentBracketData | null;
  showcase: TournamentShowcase;
  registeredTeams?: RegisteredTournamentTeam[];
  isCompleted: boolean;
  registrationState: TournamentRegistrationState;
  isRegistrationOpen: boolean;
  isSlotsFull: boolean;
  isRegistrationClosed: boolean;
  createdAt?: string;
  updatedAt?: string;
};

const fetchJson = async <T>(path: string): Promise<T> => {
  return fetchApiJson<T>(path, { cache: "no-store" }, "Tournament request failed.");
};

export const getTournamentStatusLabel = (status: TournamentStatus) =>
  status.replace(/_/g, " ");

export const getTournamentStatusBadgeClassName = (status: TournamentStatus) =>
  `status status-${status}`;

export const canRegisterForTournament = (tournament: Tournament) =>
  tournament.registrationState === "registration_open";

export const getTournamentRegistrationLabel = (tournament: Tournament) => {
  if (tournament.registrationState === "slots_full") {
    return "Slots Full";
  }

  if (tournament.registrationState === "registration_closed") {
    return "Registration Closed";
  }

  return "Registration Open";
};

export const getTournamentRegistrationShortLabel = (tournament: Tournament) => {
  if (tournament.registrationState === "slots_full") {
    return "Full";
  }

  if (tournament.registrationState === "registration_closed") {
    return "Closed";
  }

  return "Open";
};

export const getTournamentCapacityPercentage = (tournament: Tournament) =>
  Math.min(
    100,
    Math.round((tournament.registrationCount / Math.max(tournament.maxTeams, 1)) * 100)
  );

export const getFeaturedTournaments = (tournaments: Tournament[], limit = 3) => {
  const featured = tournaments.filter((tournament) => tournament.isFeatured);
  const source = featured.length > 0 ? featured : tournaments;
  return source.slice(0, limit);
};

export const fetchPublicTournaments = async (game?: string) => {
  const params = new URLSearchParams();
  if (game && game !== "all") {
    params.set("game", game);
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const data = await fetchJson<{ tournaments: Tournament[] }>(`/api/tournaments${suffix}`);
  return data.tournaments;
};

export const fetchPublicTournamentBySlug = async (slug: string) => {
  const data = await fetchJson<{ tournament: Tournament }>(`/api/tournaments/${slug}`);
  return data.tournament;
};

export const fetchRegisterableTournaments = async () => {
  const tournaments = await fetchPublicTournaments();
  return tournaments.filter(canRegisterForTournament);
};
