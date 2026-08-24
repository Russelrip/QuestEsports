import { fetchApiJson } from "@/lib/api";

// Mirrors the public projection in
// backend/src/modules/players/player-profile.service.js. That endpoint
// deliberately omits email, phone, the Discord snowflake and the PUUID, so this
// type has no field for any of them — adding one here should mean the backend
// changed, not that the page wanted more.

export type PlayerGameAccount = {
  game: string;
  username: string | null;
  tagline: string | null;
  region: string | null;
  verificationStatus: string;
};

export type PlayerRanking = {
  game: string;
  position: number | null;
  elo: number | null;
  tier: string | null;
  rankInTier: number | null;
  peakTier: string | null;
  peakSeason: string | null;
  // Every ranking is as-of. The cache exists so the page still renders when the
  // leaderboard service is unreachable, which makes staleness normal rather
  // than exceptional — so it is shown, not hidden.
  syncedAt: string;
};

export type PlayerTeam = {
  name: string;
  tag: string | null;
  game: string | null;
  role: string;
};

export type PlayerTournament = {
  tournamentSlug: string;
  tournamentTitle: string;
  game: string | null;
  startDate: string | null;
  status: string;
  teamName: string;
  role: string;
  // The name committed to that tournament, from the frozen roster snapshot.
  // null means the entry predates snapshots, not that there was no account.
  playedAs: { username: string | null; tagline: string | null } | null;
};

export type PlayerProfile = {
  publicId: string;
  displayName: string;
  memberSince: string;
  discordLinked: boolean;
  gameAccounts: PlayerGameAccount[];
  rankings: PlayerRanking[];
  teams: PlayerTeam[];
  tournaments: PlayerTournament[];
  stats: { tournamentsPlayed: number; gamesPlayed: number };
};

export const fetchPlayerProfile = async (publicId: string) => {
  const data = await fetchApiJson<{ player: PlayerProfile }>(
    `/api/players/${encodeURIComponent(publicId)}`,
    { next: { revalidate: 120 } },
  );
  return data.player;
};

export const formatRiotId = (account: {
  username: string | null;
  tagline: string | null;
}) => {
  if (!account.username) return null;
  return account.tagline ? `${account.username}#${account.tagline}` : account.username;
};

// Titles are referenced by slug throughout the API. Fall back to the slug
// rather than rendering an empty string for one Quest has not seen before.
const GAME_LABELS: Record<string, string> = {
  valorant: "VALORANT",
  codm: "Call of Duty: Mobile",
  mlbb: "Mobile Legends: Bang Bang",
  "pubg-mobile": "PUBG Mobile",
  "free-fire": "Free Fire",
};

export const formatGame = (slug: string | null) =>
  slug ? (GAME_LABELS[slug] ?? slug) : "Unknown game";

const VERIFICATION_LABELS: Record<string, string> = {
  resolved: "Resolved",
  user_confirmed: "Confirmed by player",
  discord_corroborated: "Corroborated via Discord",
  admin_verified: "Verified by staff",
  legacy_unverified: "Unverified",
  revoked: "Revoked",
};

// Says exactly what was proven and nothing more. Quest cannot prove account
// ownership — the VALORANT upstream resolves accounts through HenrikDev, which
// shows an account exists but never that the signed-in player holds it — so no
// label here may imply ownership.
export const formatVerification = (status: string) =>
  VERIFICATION_LABELS[status] ?? status;
