import { fetchApiJson } from "@/lib/api";

export type MatchStatus =
  | "not_scheduled"
  | "scheduled"
  | "check_in_open"
  | "veto_starting_soon"
  | "veto_in_progress"
  | "ready"
  | "live"
  | "delayed"
  | "paused"
  | "completed"
  | "cancelled"
  | "walkover";

export type MatchParticipant = {
  id: string;
  slot: 1 | 2;
  registrationId: string | null;
  externalParticipantId: string | null;
  displayName: string;
  seed: number | null;
  score: string | null;
  result: string | null;
  logoUrl: string | null;
};

export type LiveMatch = {
  id: string;
  tournament: {
    id: string;
    slug: string;
    title: string;
    game: string;
    status: string;
    isPublished: boolean;
  };
  source: "quest" | "challonge";
  externalId: string | null;
  identifier: string;
  roundNumber: number | null;
  status: MatchStatus;
  scheduledAt: string | null;
  estimatedAt: string | null;
  station: string | null;
  checkInDeadline: string | null;
  vetoStartAt: string | null;
  assignedStaff: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
  } | null;
  localNotes?: string | null;
  scoreData: { scoresCsv?: string | null };
  winnerSlot: number | null;
  completedAt: string | null;
  participants: MatchParticipant[];
  updatedAt: string;
};

export type HomeTournament = {
  id: string;
  slug: string;
  title: string;
  game: string;
  status: string;
  startDate: string | null;
  registrationDeadline: string | null;
  registrationOpen: boolean;
  prizePool: string;
  bannerUrl: string | null;
  isFeatured: boolean;
  sponsors: Array<{
    id: string;
    name: string;
    partnershipLabel: string;
    logoUrl: string | null;
    websiteUrl: string | null;
  }>;
};

export type HomeFeed = {
  nextMatch: LiveMatch | null;
  recentResults: LiveMatch[];
  upcomingMatches: LiveMatch[];
  featuredTournaments: HomeTournament[];
  featuredCompetitors: Array<{
    id: string;
    displayName: string;
    entryType: "team" | "solo";
    logoUrl: string | null;
    tournament: { slug: string; title: string; game: string };
  }>;
};

export type BracketResponse = {
  source: "challonge" | "native" | "none";
  status: "fresh" | "stale" | "unavailable";
  data: unknown;
  syncedAt: string | null;
  error: { code: string; message: string } | null;
  externalUrl: string | null;
};

type V1Envelope<T> = {
  success: boolean;
  data: T;
  meta: {
    serverNow: string;
    pagination?: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  };
};

export async function fetchHomeFeed() {
  return fetchApiJson<V1Envelope<HomeFeed>>(
    "/api/v1/home",
    { next: { revalidate: 15 } },
    "Live tournament information is temporarily unavailable."
  );
}

export async function fetchTournamentMatches(slug: string) {
  return fetchApiJson<V1Envelope<LiveMatch[]>>(
    `/api/v1/tournaments/${encodeURIComponent(slug)}/matches?pageSize=50`,
    { cache: "no-store", credentials: "include" },
    "Could not load the match schedule."
  );
}

export async function fetchNextMatch(scope: "public" | "me" = "public") {
  return fetchApiJson<V1Envelope<LiveMatch | null>>(
    `/api/v1/matches/next?scope=${scope}`,
    { cache: "no-store", credentials: "include" },
    "Could not load the next match."
  );
}

export async function fetchTournamentBracket(slug: string) {
  return fetchApiJson<V1Envelope<BracketResponse>>(
    `/api/v1/tournaments/${encodeURIComponent(slug)}/bracket`,
    { cache: "no-store" },
    "Could not load the tournament bracket."
  );
}

export const matchStatusLabel = (status: MatchStatus) =>
  status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export const matchStatusTone = (status: MatchStatus) => {
  if (status === "live") return "border-rose-300/35 bg-rose-400/10 text-rose-100";
  if (["completed", "ready"].includes(status)) return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
  if (["delayed", "paused", "veto_starting_soon"].includes(status)) return "border-amber-300/30 bg-amber-400/10 text-amber-100";
  if (["cancelled", "walkover"].includes(status)) return "border-slate-300/20 bg-slate-400/8 text-slate-300";
  return "border-blue-300/25 bg-blue-400/8 text-blue-100";
};
