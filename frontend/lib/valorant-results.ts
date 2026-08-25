import { fetchApiJson } from "@/lib/api";

// Mirrors the public projection in
// backend/src/modules/valorant/valorant-public.service.js. That endpoint
// deliberately omits the PUUID, the staff who created a binding, and the
// upstream operation ledger, so this file has no field for any of them —
// adding one here should mean the backend changed, not that a page wanted more.
//
// "Match" means the SERIES, as it does on VLR: a bo1/bo3/bo5 with one scoreboard
// per map. It is not a Quest bracket row; nothing joins the two yet.

export type MatchSide = "red" | "blue";
export type TeamSlot = "a" | "b";

export type ScoreboardPlayer = {
  displayName: string | null;
  tagline: string | null;
  side: MatchSide;
  agentId: string | null;
  agentName: string | null;
  // Present only when the PUUID resolved to a Quest player. Absent is the
  // ordinary case — most of a VALORANT lobby has never touched Quest.
  profile: { publicId: string; displayName: string } | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  plusMinus: number | null;
  // Derived server-side from the stored counters and the round total. null
  // means the upstream never reported the counter, which is a different fact
  // from zero and must not render the same.
  acs: number | null;
  adr: number | null;
  headshotPercent: number | null;
};

export type MatchMap = {
  gameNumber: number;
  mapName: string | null;
  startedAt: string | null;
  durationMs: number | null;
  teamASide?: MatchSide;
  teamBSide?: MatchSide;
  teamAScore: number | null;
  teamBScore: number | null;
  winner: TeamSlot | null;
  // A map the series records as played but for which no scoreboard was ever
  // imported. Rendered as an honest gap rather than an invented 0-0.
  scoreboardAvailable: boolean;
  players: ScoreboardPlayer[];
};

export type MatchTeam = { name: string | null; tag: string | null };

export type PublicMatch = {
  id: string;
  format: string;
  playedAt: string | null;
  tournament: { slug: string; title: string } | null;
  teams: { a: MatchTeam; b: MatchTeam };
  winner: TeamSlot | null;
  mapsWon: { a: number; b: number };
  maps: MatchMap[];
};

export type TournamentResult = {
  id: string;
  format: string;
  playedAt: string | null;
  teams: { a: MatchTeam; b: MatchTeam };
  winner: TeamSlot | null;
  mapsWon: { a: number; b: number };
  maps: Array<{
    gameNumber: number;
    mapName: string | null;
    teamAScore: number | null;
    teamBScore: number | null;
    winner: TeamSlot | null;
  }>;
};

export type TournamentResults = {
  tournament: { slug: string; title: string };
  results: TournamentResult[];
};

export const fetchPublicMatch = async (seriesId: string) => {
  const data = await fetchApiJson<{ match: PublicMatch }>(
    `/api/v1/valorant/series/${encodeURIComponent(seriesId)}`,
    { next: { revalidate: 120 } },
  );
  return data.match;
};

export const fetchTournamentResults = async (slug: string) =>
  fetchApiJson<TournamentResults>(
    `/api/v1/tournaments/${encodeURIComponent(slug)}/results`,
    { next: { revalidate: 120 } },
  );

export const teamLabel = (team: MatchTeam) => team.name ?? "Unknown team";

export const formatRiotName = (player: {
  displayName: string | null;
  tagline: string | null;
}) => {
  if (!player.displayName) return "—";
  return player.tagline ? `${player.displayName}#${player.tagline}` : player.displayName;
};

const FORMAT_LABELS: Record<string, string> = { bo1: "Best of 1", bo3: "Best of 3", bo5: "Best of 5" };

export const formatSeriesFormat = (format: string) => FORMAT_LABELS[format] ?? format.toUpperCase();

// A map duration is only ever shown rounded to the minute: the upstream reports
// milliseconds, and second-level precision on a 35-minute map is noise.
export const formatDuration = (durationMs: number | null) => {
  if (typeof durationMs !== "number" || durationMs <= 0) return null;
  const totalMinutes = Math.round(durationMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

// A stat that was never reported renders as an em dash, never as 0. The
// distinction is the whole reason the backend stores null.
export const statValue = (value: number | null, suffix = "") =>
  value === null ? "—" : `${value}${suffix}`;
