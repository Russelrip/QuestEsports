const { prisma } = require("../../lib/prisma");

// The public VALORANT read path: a VLR-style match page and a tournament
// results list.
//
// Everything here is a PROJECTION, never a model dump — the same boundary
// `modules/players/player-profile.service.js` draws, for the same reason. The
// adjacent data is sensitive: `match_player_stats.puuid` is a stable
// cross-service key the audit policy already treats as sensitive, bindings
// carry the staff user who made them, and the operation ledger records upstream
// request ids. None of that is competitive information.
//
// The rule: a field is included only if it is already public elsewhere — a
// scoreboard line appears on any match page, a team name appears on a bracket.
// Everything else is omitted BY CONSTRUCTION. The `select` below never asks for
// `puuid`, because a projection that fetches it and strips it later is one
// careless refactor from leaking it.
//
// "Match" here means what it means on VLR: the SERIES (a bo1/bo3/bo5), not one
// map and not a Quest bracket row. `match_maps.match_id` — the bracket link —
// is still NULL for every row, so nothing in this file reads it. When that link
// is populated a bracket page can join to these, but it cannot yet.

// Only a finalized series is a result. A draft is admin bookkeeping mid-import,
// an orphaned or reconciliation_required series is a known-inconsistent record,
// and publishing either would put a number on a public page that staff have not
// stood behind.
const PUBLIC_SERIES_STATUSES = ["finalized"];

// The series id reaches this route straight from a URL. Prisma raises on a
// value Postgres cannot cast to uuid, which would surface as a 400 carrying a
// database message; a public route must answer "no such match" instead.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-player counters, as stored. Ratios are NOT stored — see the migration —
// so the ones a scoreboard shows are derived here, once, next to the rounds
// they divide by.
const playerStatSelect = {
  // `puuid` is deliberately absent. It is the join key to `game_accounts` and
  // never leaves the server; the link to a Quest profile travels as `publicId`.
  displayName: true,
  tagline: true,
  side: true,
  agentId: true,
  agentName: true,
  scoreTotal: true,
  kills: true,
  deaths: true,
  assists: true,
  damageDealt: true,
  damageReceived: true,
  headshots: true,
  bodyshots: true,
  legshots: true,
  player: { select: { publicId: true, displayName: true } },
};

const matchMapSelect = {
  mapName: true,
  startedAt: true,
  durationMs: true,
  redScore: true,
  blueScore: true,
  winningSide: true,
  playerStats: { select: playerStatSelect },
};

// A ratio needs a denominator that exists. Rounds come from the map score, so a
// map still in progress — or one whose scores never arrived — yields null
// rather than a number divided by zero or by a guess.
const roundsPlayed = (map) => {
  if (typeof map.redScore !== "number" || typeof map.blueScore !== "number") return null;
  const rounds = map.redScore + map.blueScore;
  return rounds > 0 ? rounds : null;
};

const ratio = (numerator, denominator, decimals = 1) => {
  if (typeof numerator !== "number" || !denominator) return null;
  return Number((numerator / denominator).toFixed(decimals));
};

// ACS, ADR and HS% are computed on read and never stored, so a change to how
// the upstream counts score or damage does not leave a stale number in a table.
const mapPlayerStat = (stat, rounds) => {
  const shots = [stat.headshots, stat.bodyshots, stat.legshots];
  const totalShots = shots.every((value) => typeof value === "number")
    ? shots.reduce((total, value) => total + value, 0)
    : null;

  return {
    // A scoreboard row identifies someone by the name they played under. That
    // name is already public wherever this match is; the PUUID behind it is not.
    displayName: stat.displayName,
    tagline: stat.tagline,
    side: stat.side,
    agentId: stat.agentId,
    agentName: stat.agentName,
    // Present only when the PUUID resolved to a Quest player. This is what
    // turns a scoreboard into a profile network — and its absence is the normal
    // case, since most of a VALORANT lobby has never touched Quest.
    profile: stat.player
      ? { publicId: stat.player.publicId, displayName: stat.player.displayName }
      : null,
    kills: stat.kills,
    deaths: stat.deaths,
    assists: stat.assists,
    // Null, never zero, when the upstream did not report the counter: a player
    // with no kills and a player with no data must not render the same.
    plusMinus:
      typeof stat.kills === "number" && typeof stat.deaths === "number"
        ? stat.kills - stat.deaths
        : null,
    acs: ratio(stat.scoreTotal, rounds, 0),
    adr: ratio(stat.damageDealt, rounds, 0),
    headshotPercent: ratio(
      typeof stat.headshots === "number" && totalShots ? stat.headshots * 100 : null,
      totalShots,
    ),
  };
};

// Which Quest team was on which side, for THIS map. The sides swap between maps
// in a series, so this is a per-game fact and cannot be hoisted to the series.
const sideForTeam = (game, slot) => (slot === "a" ? game.teamASide : game.teamBSide);

const mapGame = (game) => {
  const map = game.matchMap;
  if (!map) {
    // The series knows a map was played but no scoreboard was ever imported for
    // it. Reporting the map with null scores is honest; inventing a 0-0 is not.
    return {
      gameNumber: game.gameNumber,
      mapName: game.mapName,
      startedAt: null,
      durationMs: null,
      teamAScore: null,
      teamBScore: null,
      winner: null,
      scoreboardAvailable: false,
      players: [],
    };
  }

  const rounds = roundsPlayed(map);
  const scoreForSide = (side) => (side === "red" ? map.redScore : map.blueScore);
  const teamASide = sideForTeam(game, "a");
  const teamBSide = sideForTeam(game, "b");

  let winner = null;
  if (map.winningSide === teamASide) winner = "a";
  else if (map.winningSide === teamBSide) winner = "b";

  return {
    gameNumber: game.gameNumber,
    mapName: map.mapName || game.mapName,
    startedAt: map.startedAt,
    durationMs: map.durationMs,
    teamASide,
    teamBSide,
    teamAScore: scoreForSide(teamASide),
    teamBScore: scoreForSide(teamBSide),
    winner,
    scoreboardAvailable: map.playerStats.length > 0,
    // Sorted by ACS the way every scoreboard is, with unreported rows last
    // rather than sorted as if they were zero.
    players: map.playerStats
      .map((stat) => mapPlayerStat(stat, rounds))
      .sort((a, b) => {
        if (a.acs === null && b.acs === null) return 0;
        if (a.acs === null) return 1;
        if (b.acs === null) return -1;
        return b.acs - a.acs;
      }),
  };
};

// A team's public name. The binding may have been detached, or the saved team
// deleted, long after the series was played; the result still happened, so it
// renders with whatever name survives rather than disappearing.
const mapTeam = (binding) => ({
  name: binding?.savedTeam?.name ?? null,
  tag: binding?.savedTeam?.teamTag ?? null,
});

const seriesSelect = {
  id: true,
  format: true,
  status: true,
  playedAt: true,
  // No binding ids and no winner column. Quest's own series row records who
  // played and when, not who won — the upstream owns the rating engine and
  // Quest never copied a winner column — so the result is read from the maps,
  // which is also the only version a reader can check against the scoreboard.
  bindingA: { select: { savedTeam: { select: { name: true, teamTag: true } } } },
  bindingB: { select: { savedTeam: { select: { name: true, teamTag: true } } } },
  tournament: { select: { slug: true, title: true, isPublished: true } },
};

// The series winner is whoever won more maps. A tie — or a series whose maps
// were never imported — yields null rather than a guess.
const winnerSlot = (tally) => {
  if (tally.a > tally.b) return "a";
  if (tally.b > tally.a) return "b";
  return null;
};

const mapsWon = (games) => games.reduce(
  (tally, game) => {
    if (game.winner === "a") tally.a += 1;
    if (game.winner === "b") tally.b += 1;
    return tally;
  },
  { a: 0, b: 0 },
);

// A published tournament only. An unpublished event is staff-only, and leaking
// one through a results page is exactly the kind of disclosure nobody thinks to
// check for — the player profile makes the same call for the same reason.
const isPublicSeries = (series) =>
  PUBLIC_SERIES_STATUSES.includes(series.status)
  && (!series.tournament || series.tournament.isPublished);

const getPublicSeries = async (seriesId) => {
  if (!seriesId || typeof seriesId !== "string") return null;
  if (!UUID_PATTERN.test(seriesId.trim())) return null;

  const series = await prisma.questValorantSeries.findUnique({
    where: { id: seriesId.trim() },
    select: {
      ...seriesSelect,
      games: {
        orderBy: { gameNumber: "asc" },
        select: {
          gameNumber: true,
          mapName: true,
          teamASide: true,
          teamBSide: true,
          matchMap: { select: matchMapSelect },
        },
      },
    },
  });

  if (!series || !isPublicSeries(series)) return null;

  const teams = { a: mapTeam(series.bindingA), b: mapTeam(series.bindingB) };
  const games = series.games.map(mapGame);
  const tally = mapsWon(games);

  return {
    id: series.id,
    format: series.format,
    playedAt: series.playedAt,
    tournament: series.tournament
      ? { slug: series.tournament.slug, title: series.tournament.title }
      : null,
    teams,
    winner: winnerSlot(tally),
    mapsWon: tally,
    maps: games,
  };
};

// The results list for one tournament. Deliberately a SUMMARY: it carries map
// scores but no scoreboards, because a 16-team event would otherwise ship a few
// hundred player rows to render a list of scorelines.
const getTournamentResults = async (slug) => {
  if (!slug || typeof slug !== "string") return null;

  const tournament = await prisma.tournament.findUnique({
    where: { slug: slug.trim().toLowerCase() },
    select: { id: true, slug: true, title: true, isPublished: true },
  });

  if (!tournament || !tournament.isPublished) return null;

  const series = await prisma.questValorantSeries.findMany({
    where: { tournamentId: tournament.id, status: { in: PUBLIC_SERIES_STATUSES } },
    orderBy: [{ playedAt: "desc" }],
    select: {
      ...seriesSelect,
      games: {
        orderBy: { gameNumber: "asc" },
        select: {
          gameNumber: true,
          mapName: true,
          teamASide: true,
          teamBSide: true,
          matchMap: {
            select: {
              mapName: true,
              startedAt: true,
              durationMs: true,
              redScore: true,
              blueScore: true,
              winningSide: true,
              // No player rows in the list projection.
              playerStats: { select: { side: true }, take: 1 },
            },
          },
        },
      },
    },
  });

  return {
    tournament: { slug: tournament.slug, title: tournament.title },
    results: series.map((entry) => {
      const games = entry.games.map(mapGame);
      const tally = mapsWon(games);
      return {
        id: entry.id,
        format: entry.format,
        playedAt: entry.playedAt,
        teams: { a: mapTeam(entry.bindingA), b: mapTeam(entry.bindingB) },
        winner: winnerSlot(tally),
        mapsWon: tally,
        maps: games.map((game) => ({
          gameNumber: game.gameNumber,
          mapName: game.mapName,
          teamAScore: game.teamAScore,
          teamBScore: game.teamBScore,
          winner: game.winner,
        })),
      };
    }),
  };
};

module.exports = {
  PUBLIC_SERIES_STATUSES,
  getPublicSeries,
  getTournamentResults,
};
