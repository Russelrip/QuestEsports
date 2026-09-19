const crypto = require("crypto");
const { valorantRequest } = require("./valorant.client");
const { mapMatchSummary, mapMatchDetail } = require("./valorant.mapper");
const { runTransaction } = require("./valorant-operations");
const { requireSeriesWithUuid } = require("./valorant-series.service");

const VALORANT_SIDES = new Set(["red", "blue"]);
const asSide = (value) => (VALORANT_SIDES.has(value) ? value : null);

// A PUUID is the join key to `game_accounts`, which stores it normalized under a
// CHECK constraint; `match_player_stats` carries the same one. Normalize here
// rather than trusting the upstream's casing — a mismatch does not raise, it
// silently fails to resolve a real Quest player into a stranger.
const normalizePuuid = (value) => String(value || "").trim().toLowerCase();

// Only active accounts for this title can be matched. Everyone else stays an
// unlinked row rendered from their display-name snapshot, which is most of a
// public VALORANT scoreboard and not an error.
const resolvePlayerIdsByPuuid = async (client, puuids) => {
  if (puuids.length === 0) {
    return new Map();
  }
  const accounts = await client.gameAccount.findMany({
    where: { game: "valorant", status: "active", externalId: { in: puuids } },
    select: { playerId: true, externalId: true },
  });
  return new Map(accounts.map((account) => [account.externalId, account.playerId]));
};

// The structured half of the projection: `match_maps` and `match_player_stats`,
// which a public page can sort, filter and aggregate. `rosterSummary` is still
// written alongside and stays authoritative until reads move — expand, never
// contract.
const upsertMatchStructuredStats = async (client, questValorantMatchId, mapped) => {
  const players = (mapped.players || [])
    .map((player) => ({ ...player, puuid: normalizePuuid(player.puuid) }))
    .filter((player) => player.puuid && asSide(player.side));

  const matchMapFields = {
    mapName: mapped.mapName,
    mapExternalId: mapped.mapId ?? null,
    startedAt: new Date(mapped.startedAt),
    durationMs: mapped.durationMs ?? null,
    gameVersion: mapped.gameVersion ?? null,
    redScore: mapped.redScore ?? null,
    blueScore: mapped.blueScore ?? null,
    winningSide: asSide(mapped.winningSide),
  };

  const matchMap = await client.matchMap.upsert({
    where: { questValorantMatchId },
    create: { questValorantMatchId, ...matchMapFields },
    update: matchMapFields,
  });

  const playerIdsByPuuid = await resolvePlayerIdsByPuuid(client, players.map((player) => player.puuid));

  for (const player of players) {
    // Every counter is written as null rather than skipped when the upstream
    // omits it: "not reported" and zero are different facts, and a scoreboard
    // must not render them the same.
    const stat = {
      playerId: playerIdsByPuuid.get(player.puuid) ?? null,
      displayName: player.name ?? null,
      tagline: player.tag ?? null,
      side: player.side,
      agentId: player.agentId ?? null,
      agentName: player.agentName ?? null,
      scoreTotal: player.scoreTotal ?? null,
      kills: player.kills ?? null,
      deaths: player.deaths ?? null,
      assists: player.assists ?? null,
      damageDealt: player.damageDealt ?? null,
      damageReceived: player.damageReceived ?? null,
      headshots: player.headshots ?? null,
      bodyshots: player.bodyshots ?? null,
      legshots: player.legshots ?? null,
    };
    await client.matchPlayerStat.upsert({
      where: { matchMapId_puuid: { matchMapId: matchMap.id, puuid: player.puuid } },
      create: { matchMapId: matchMap.id, puuid: player.puuid, ...stat },
      update: stat,
    });
  }

  // A re-import that drops a player means the earlier scoreboard was wrong, so
  // the stale row goes. Guarded on a non-empty roster on purpose: an empty
  // player list is far more likely a partial upstream response than a match
  // genuinely played by nobody, and wiping a good scoreboard over one is worse
  // than leaving it briefly stale.
  if (players.length > 0) {
    await client.matchPlayerStat.deleteMany({
      where: {
        matchMapId: matchMap.id,
        puuid: { notIn: players.map((player) => player.puuid) },
      },
    });
  }

  return matchMap;
};

const upsertMatchProjection = (detail) => {
  const mapped = mapMatchDetail(detail);
  const projection = {
    matchId: mapped.matchId,
    mapName: mapped.mapName,
    startedAt: new Date(mapped.startedAt),
    mode: mapped.mode || undefined,
    queue: mapped.queue || undefined,
    redScore: mapped.redScore ?? undefined,
    blueScore: mapped.blueScore ?? undefined,
    winningSide: mapped.winningSide || undefined,
    rosterSummary: { players: mapped.players },
    lastSyncedAt: new Date(),
  };
  // One transaction: a cached match whose structured scoreboard failed to write
  // would read as a match nobody played.
  return runTransaction(async (tx) => {
    const questValorantMatch = await tx.questValorantMatch.upsert({
      where: { henrikMatchId: mapped.henrikMatchId },
      create: { henrikMatchId: mapped.henrikMatchId, ...projection },
      update: projection,
    });
    await upsertMatchStructuredStats(tx, questValorantMatch.id, mapped);
    return questValorantMatch;
  });
};

const importMatch = async ({ henrikMatchId, affinity = "eu", actorUserId }) => {
  const response = await valorantRequest({
    method: "POST",
    path: "/api/v1/matches/import",
    body: { match_id: henrikMatchId, affinity },
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  // Real FastAPI returns MatchImportResponse { match: MatchDetailResponse, created: bool }
  // (app/schemas/matches.py:124-126) — not a bare MatchDetailResponse.
  const importResponse = response.data;
  const detail = importResponse.match;
  const created = importResponse.created ?? (response.status === 201);
  const projection = await upsertMatchProjection(detail);
  return { match: mapMatchDetail(detail), created, projection };
};

const getMatchByHenrikId = async ({ henrikMatchId, actorUserId }) => {
  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/matches/by-henrik-id/${encodeURIComponent(henrikMatchId)}`,
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return mapMatchDetail(response.data);
};

const listMatches = async ({ cursor = null, limit = 25, actorUserId } = {}) => {
  const query = new URLSearchParams();
  if (cursor) query.set("cursor", cursor);
  if (limit) query.set("limit", String(limit));
  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/matches${query.size ? `?${query}` : ""}`,
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return response.data;
};

// Series-relevant matches (spec: GET /api/v1/series/{series_id}/matches):
// every match between the two anchored players, each carrying the anchor side.
const listSeriesMatches = async ({ seriesId, actorUserId }) => {
  const series = await requireSeriesWithUuid({ seriesId });
  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/series/${series.valorantSeriesUuid}/matches`,
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return (response.data.matches || []).map(mapMatchSummary);
};

module.exports = {
  upsertMatchProjection,
  importMatch,
  getMatchByHenrikId,
  listMatches,
  listSeriesMatches,
};
