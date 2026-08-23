import { fetchApiJson } from "./api";
import type { TicketedEvent } from "@/lib/tickets";

export type TournamentStatus =
  | "draft"
  | "upcoming"
  | "registration_open"
  | "ongoing"
  | "completed"
  | "cancelled";

export type EventStatus = "draft" | "upcoming" | "open" | "closed" | "completed";

export type EventRegistrationState = "open" | "upcoming" | "closed" | "completed";

export type TournamentRegistrationState =
  | "registration_open"
  | "upcoming"
  | "registration_closed"
  | "slots_full"
  | "waitlist_open"
  | "already_registered";

type TournamentRegistrationMode = "open_entry" | "slot_based";
export type PersonalRegistrationState = "loading" | "ready" | "registered";
type TournamentEntryType = "team" | "solo";
type TournamentPaymentMethod = "free" | "payhere" | "bank_transfer";
type TournamentDateStatus = "scheduled" | "tba" | "tbd";

export type TournamentRegistrationField = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "checkbox" | "url";
  scope: "entry" | "member";
  required: boolean;
  options: string[];
};

export type TournamentScheduleData = {
  sheetName: string;
  headers: string[];
  rows: Record<string, string>[];
};

type TournamentShowcase = {
  posterUrl: string | null;
  firstPlaceUrl: string | null;
  secondPlaceUrl: string | null;
  thirdPlaceUrl: string | null;
};

type TournamentResultSummary = {
  status: string;
  completedAt: string | null;
  standings: Array<{
    rank: number;
    name: string;
    seed: number | null;
    logoUrl: string | null;
  }>;
};

export type TournamentEventMedia = {
  id: string;
  title: string;
  description?: string | null;
  category: string;
  createdAt: string;
  imageUrl: string;
};

export type TournamentEventAlbum = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  location?: string | null;
  eventDate?: string | null;
  photoCount: number;
  photos: Array<{ id: string; caption?: string | null; imageUrl: string }>;
};

type RegisteredTournamentTeam = {
  id: string;
  teamName: string;
  logoUrl: string | null;
  shortCode: string;
  memberCount: number;
  status: string;
};

type RegisteredTournamentParticipant = {
  id: string;
  entryType: TournamentEntryType;
  displayName: string;
  logoUrl: string | null;
  avatarUrl: string | null;
  captainName: string;
  shortCode: string;
  memberCount: number;
};

export type TournamentParticipantPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type GameCategory = {
  id: string;
  slug: string;
  displayName: string;
  artworkUrl: string | null;
  logoUrl: string | null;
  displayOrder?: number;
  isPublished?: boolean;
  tournamentCount?: number;
};

export type TournamentSponsor = {
  id: string;
  name: string;
  partnershipLabel: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  displayOrder: number;
};

export type EventSeries = {
  id: string;
  slug: string;
  title: string;
  description: string;
  heroUrl: string | null;
  bannerUrl?: string | null;
  shortName?: string | null;
  subtitle?: string | null;
  shortDescription?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  registrationOpenAt?: string | null;
  registrationCloseAt?: string | null;
  venue?: string | null;
  location?: string | null;
  country?: string | null;
  organizer?: string | null;
  websiteUrl?: string | null;
  discordUrl?: string | null;
  eventStatus?: EventStatus;
  aggregate?: EventAggregate;
  games?: number;
  teamsRegistered?: number;
  playersRegistered?: number;
  availableSlots?: number;
  registrationState?: EventRegistrationState;
  displayOrder: number;
  isPublished: boolean;
  featured?: boolean;
  tournaments: Tournament[];
  ticketEvent?: TicketedEvent | null;
};

export type EventAggregate = {
  games: number;
  teamsRegistered: number;
  playersRegistered: number;
  availableSlots: number;
  registrationState: EventRegistrationState;
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

type BracketOpponent = {
  id: number | null;
  position?: number;
  score?: number;
  result?: "win" | "loss" | "draw";
};

type BracketStage = {
  id: number;
  name: string;
  type: string;
};

type BracketGroup = {
  id: number;
  stage_id: number;
  number: number;
};

type BracketRound = {
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
  gameCategory: GameCategory | null;
  organizer: string;
  country: string;
  location: string;
  series: { id: string; slug: string; title: string } | null;
  seriesOrder: number;
  displayPriority: number;
  bannerUrl: string | null;
  heroUrl: string | null;
  shortDescription: string;
  fullDescription: string;
  rules: string | null;
  rulebook: {
    id: string;
    slug: string;
    title: string;
    game: string;
    variant: string;
  } | null;
  registrationOpenAt: string | null;
  startDate: string | null;
  startDateStatus: TournamentDateStatus;
  endDate: string | null;
  endDateStatus: TournamentDateStatus;
  registrationDeadline: string | null;
  registrationDeadlineStatus: TournamentDateStatus;
  format: string;
  registrationMode: TournamentRegistrationMode;
  entryType: TournamentEntryType;
  teamSize: number;
  minRosterSize: number;
  maxRosterSize: number;
  maxSubstitutes: number;
  allowCoach: boolean;
  coachRequired: boolean;
  waitlistEnabled: boolean;
  registrationFields: TournamentRegistrationField[];
  paymentMethod: TournamentPaymentMethod;
  registrationFee: { amount: number; currency: string };
  registrationFeeTiers: Array<{ startSlot: number; endSlot: number; amount: number }>;
  registrationPaymentAvailable: boolean;
  reservationMinutes: number;
  bankTransferReviewMinutes: number;
  bankName?: string | null;
  bankBranch?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  maxTeams: number;
  registrationCount: number;
  capacityUsed: number;
  prizePool: string;
  status: TournamentStatus;
  isPublished: boolean;
  showBracketPublicly?: boolean;
  bracketLink: string | null;
  challongeEmbedUrl?: string | null;
  bracketSource?: "challonge" | "native" | "none";
  sponsors: TournamentSponsor[];
  contactLink: string | null;
  isFeatured: boolean;
  scheduleData: TournamentScheduleData | null;
  bracketSummary: TournamentBracketSummary | null;
  bracketData: TournamentBracketData | null;
  showcase: TournamentShowcase;
  eventMedia: TournamentEventMedia[];
  eventAlbums: TournamentEventAlbum[];
  resultSummary?: TournamentResultSummary | null;
  registeredTeams?: RegisteredTournamentTeam[];
  registeredParticipants?: RegisteredTournamentParticipant[];
  participantPagination?: TournamentParticipantPagination;
  isCompleted: boolean;
  registrationState: TournamentRegistrationState;
  registrationLabel?: string;
  createdAt?: string;
  updatedAt?: string;
};

const fetchJson = async <T>(path: string): Promise<T> => {
  return fetchApiJson<T>(
    path,
    { next: { revalidate: 15 } },
    "Tournament request failed."
  );
};

export const getTournamentStatusLabel = (status: TournamentStatus) =>
  status.replace(/_/g, " ");

export const getTournamentRegistrationPresentation = (tournament: Tournament) => {
  const state = tournament.registrationState;
  const isWaitlist = state === "waitlist_open";
  const isActionable = state === "registration_open" || isWaitlist;
  return {
    state,
    isWaitlist,
    isActionable,
    registrationHref: isActionable
      ? `/tournaments/${tournament.slug}/register`
      : `/tournaments/${tournament.slug}`,
    label: getTournamentRegistrationLabel(tournament),
  };
};

export const canRegisterForTournament = (tournament: Tournament) =>
  getTournamentRegistrationPresentation(tournament).isActionable;

export const getTournamentRegistrationLabel = (tournament: Tournament) => {
  switch (tournament.registrationState) {
    case "waitlist_open":
      return tournament.registrationLabel || "Join waitlist";
    case "slots_full":
      return "Slots Full";
    case "registration_closed":
      return "Registration Closed";
    case "already_registered":
      return "Already Registered";
    case "upcoming":
      return "Registration opens soon";
    case "registration_open":
      return tournament.registrationMode === "slot_based"
        ? "Slots Available"
        : "Registration Open";
  }
};

export const getRegistrationButtonLabel = (
  tournament: Tournament,
  personalState: PersonalRegistrationState,
) => {
  if (personalState === "loading") return "Checking...";
  if (personalState === "registered") return "Registered";
  const presentation = getTournamentRegistrationPresentation(tournament);
  if (!presentation.isActionable) return presentation.label;
  if (presentation.isWaitlist) return presentation.label;
  return tournament.registrationMode === "slot_based" ? "Reserve Slot" : "Register Now";
};

export const getTournamentRegistrationModeLabel = (tournament: Tournament) =>
  tournament.registrationMode === "slot_based" ? "Slot Based" : "Open Entry";

export const getFeaturedTournaments = (tournaments: Tournament[], limit = 3) => {
  const featured = tournaments.filter((tournament) => tournament.isFeatured);
  const source = featured.length > 0 ? featured : tournaments;
  return [...source]
    .sort((left, right) => {
      const leftDate = new Date(left.startDate || left.createdAt || 0).getTime();
      const rightDate = new Date(right.startDate || right.createdAt || 0).getTime();
      return rightDate - leftDate;
    })
    .slice(0, limit);
};

/**
 * Mirrors `getFeaturedTournaments`: an explicit `featured` pick wins, and with
 * none set the newest published events stand in. Backend order (displayOrder,
 * then newest) is preserved rather than re-sorted here.
 */
export const getFeaturedEvents = (events: EventSeries[], limit = 3) => {
  const withGames = events.filter((event) => event.tournaments.length > 0);
  const featured = withGames.filter((event) => event.featured);
  return (featured.length > 0 ? featured : withGames).slice(0, limit);
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

export const fetchPublicEventSeries = async () => {
  const data = await fetchJson<{ series: EventSeries[] }>("/api/event-series");
  return data.series;
};

export const fetchPublicEvents = async () => {
  const data = await fetchJson<{ events: EventSeries[] }>("/api/events");
  return data.events;
};

export const fetchPublicGameCategories = async () => {
  const data = await fetchJson<{ categories: GameCategory[] }>("/api/game-categories");
  return data.categories;
};

export const fetchPublicEventSeriesBySlug = async (slug: string) => {
  const data = await fetchJson<{ series: EventSeries }>(
    `/api/event-series/${encodeURIComponent(slug)}`
  );
  return data.series;
};

export const fetchPublicEventBySlug = async (slug: string) => {
  const data = await fetchJson<{ event: EventSeries }>(
    `/api/events/${encodeURIComponent(slug)}`
  );
  return data.event;
};

export const fetchPublicTournamentBySlug = async (
  slug: string,
  options: { participantPage?: number; participantPageSize?: number } = {
    participantPage: 1,
    participantPageSize: 10,
  },
) => {
  const page = Number.isInteger(options.participantPage) && options.participantPage! > 0
    ? options.participantPage!
    : 1;
  const pageSize = Number.isInteger(options.participantPageSize) && options.participantPageSize! > 0
    ? Math.min(options.participantPageSize!, 50)
    : 10;
  const params = new URLSearchParams();
  params.set("participantPage", String(page));
  params.set("participantPageSize", String(pageSize));
  const data = await fetchJson<{ tournament: Tournament }>(
    `/api/tournaments/${encodeURIComponent(slug)}?${params.toString()}`,
  );
  return data.tournament;
};
