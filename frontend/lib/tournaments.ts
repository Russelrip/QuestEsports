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

export type Tournament = {
  id: string;
  slug: string;
  title: string;
  game: string;
  bannerUrl: string | null;
  shortDescription: string;
  fullDescription: string;
  rules: string | null;
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
  registrationState: TournamentRegistrationState;
  isRegistrationOpen: boolean;
  isSlotsFull: boolean;
  isRegistrationClosed: boolean;
  createdAt?: string;
  updatedAt?: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const fetchJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
  });
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
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
