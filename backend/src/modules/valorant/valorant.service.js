const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { recordAudit, recordAuditInTransaction } = require("../../lib/audit");
const { valorantRequest, FastApiError } = require("./valorant.client");
const { mapTeamResponse, mapMatchCandidate, mapMatchSummary, mapMatchDetail, mapSeriesView, mapGameView, mapPreview, mapFinalizeResult, mapManualFinalizeResult, mapRankingEntry, mapRatingEvent } = require("./valorant.mapper");
const { normalizeRiotId, generateExternalKey, assertSupportedFormat, deriveManualSeriesExternalKey } = require("./valorant.validation");

const hashRequestBody = (body) =>
  crypto.createHash("sha256").update(JSON.stringify(body || {})).digest("hex");
const runTransaction = (work) => typeof prisma.$transaction === "function"
  ? prisma.$transaction(work)
  : work(prisma);

const createOperation = async ({ type, externalKey = null, questSeriesId = null, requestBody = null }) =>
  prisma.questValorantOperation.create({
    data: {
      operationId: crypto.randomUUID(),
      type,
      externalKey,
      questSeriesId,
      status: "pending",
      requestBodyHash: hashRequestBody(requestBody),
    },
  });

const markOperationSucceeded = async (operationId, { status, requestId, data }) =>
  prisma.questValorantOperation.update({
    where: { id: operationId },
    data: { status: "succeeded", responseCode: status, fastapiRequestId: requestId, responseSummary: data || undefined },
  });

const markOperationFailed = async (operationId, error) => {
  if (typeof FastApiError === "function" && error instanceof FastApiError) {
    return prisma.questValorantOperation.update({
      where: { id: operationId },
      data: {
        status: "failed",
        responseCode: error.status,
        errorCode: error.code,
        fastapiRequestId: error.requestId,
        responseSummary: error.responseSummary || undefined,
      },
    });
  }
  return prisma.questValorantOperation.update({
    where: { id: operationId },
    data: {
      status: "reconciliation_required",
      responseCode: error?.status ?? null,
      fastapiRequestId: error?.requestId ?? null,
      responseSummary: error?.responseSummary || undefined,
    },
  });
};

const markOperationReconciliationRequired = async (operationId, error, details = {}) => {
  const {
    responseCode = error?.status || null,
    fastapiRequestId = error?.requestId || null,
    ...summary
  } = details;
  return prisma.questValorantOperation.update({
    where: { id: operationId },
    data: {
      status: "reconciliation_required",
      errorCode: error?.code || "valorant_unreachable",
      responseCode,
      fastapiRequestId,
      responseSummary: Object.keys(summary).length ? summary : undefined,
    },
  });
};

const listBindings = async () =>
  prisma.valorantTeamBinding.findMany({
    include: {
      savedTeam: { select: { id: true, name: true, teamTag: true } },
      boundByUser: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
  });

// Admin team list (§6.2): Quest bindings joined with the FastAPI team catalog.
// Join shape (chosen over { bindings, teamsByUuid }): each Quest binding is
// augmented with its mapped FastAPI team under `valorantTeam` (null when the
// team no longer exists upstream). This keeps the controller's existing
// `{ bindings: [...] }` envelope intact and stays JSON-safe — a keyed-by-UUID
// object would need its own response documentation, and a Map would not
// survive res.json.
const listTeams = async ({ actorUserId }) => {
  const [bindings, teamsResponse] = await Promise.all([
    listBindings(),
    valorantRequest({
      method: "GET",
      path: "/api/v1/teams",
      actorUserId,
      operationId: crypto.randomUUID(),
      idempotent: true,
    }),
  ]);
  const teamsByUuid = new Map((teamsResponse.data || []).map((team) => [team.id, mapTeamResponse(team)]));
  return bindings.map((binding) => ({ ...binding, valorantTeam: teamsByUuid.get(binding.valorantTeamUuid) ?? null }));
};

const bindTeam = async ({ savedTeamId, actorUserId }) => {
  const savedTeam = await prisma.savedTeam.findUnique({
    where: { id: savedTeamId },
    select: { id: true, name: true, teamTag: true },
  });
  if (!savedTeam) throw new HttpError(404, "Saved team not found.");

  const existingBinding = await prisma.valorantTeamBinding.findFirst({
    where: { savedTeamId, status: "active" },
    select: { id: true },
  });
  if (existingBinding) {
    throw new HttpError(409, "This team already has an active VALORANT binding.");
  }

  const operation = await createOperation({
    type: "team_bind",
    externalKey: savedTeamId,
    actorUserId,
    requestBody: { saved_team_id: savedTeamId },
  });
  await prisma.questValorantOperation.update({
    where: { id: operation.id },
    data: { status: "in_flight" },
  });

  let response;
  try {
    response = await valorantRequest({
      method: "POST",
      path: "/api/v1/teams",
      body: { name: savedTeam.name, short_name: savedTeam.teamTag, quest_saved_team_id: savedTeamId },
      actorUserId,
      operationId: operation.operationId,
      externalKey: savedTeamId,
      idempotent: true,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }

  const team = mapTeamResponse(response.data);
  const [binding] = await prisma.$transaction([
    prisma.valorantTeamBinding.create({
      data: {
        savedTeamId,
        valorantTeamUuid: team.id,
        status: "active",
        boundByUserId: actorUserId,
      },
    }),
    prisma.savedTeam.update({
      where: { id: savedTeamId },
      data: { game: "valorant" },
    }),
  ]);
  await markOperationSucceeded(operation.id, response);
  return binding;
};

const detachBinding = async ({ bindingId, actorUserId }) => {
  const binding = await prisma.valorantTeamBinding.findUnique({
    where: { id: bindingId },
    select: { id: true, savedTeamId: true, valorantTeamUuid: true, status: true },
  });
  if (!binding) throw new HttpError(404, "VALORANT binding not found.");
  if (binding.status === "detached") throw new HttpError(409, "This binding is already detached.");

  const operation = await createOperation({
    type: "team_bind",
    externalKey: binding.savedTeamId || undefined,
    actorUserId,
    requestBody: { action: "detach", binding_id: bindingId },
  });

  const updated = await prisma.valorantTeamBinding.update({
    where: { id: bindingId },
    data: { status: "detached", detachedAt: new Date() },
  });
  await markOperationSucceeded(operation.id, { status: 200, requestId: null, data: { bindingId } });
  return updated;
};

const discover = async ({
  playerA,
  playerB,
  pageSize = 10,
  maxPages = 1,
  map = null,
  from = null,
  actorUserId,
}) => {
  const anchorA = normalizeRiotId(playerA);
  const anchorB = normalizeRiotId(playerB);
  const response = await valorantRequest({
    method: "POST",
    path: "/api/v1/match-search/two-player",
    body: {
      player_a: anchorA,
      player_b: anchorB,
      page_size: pageSize,
      max_pages: maxPages,
      ...(map ? { map } : {}),
      ...(from ? { from: new Date(from).toISOString() } : {}),
    },
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return {
    players: response.data.players || {},
    candidates: (response.data.candidates || []).map(mapMatchCandidate),
    search: response.data.search || { pagesExamined: 0, pageSize },
  };
};

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

const requireSeriesWithUuid = async ({ seriesId, status }) => {
  const series = await prisma.questValorantSeries.findUnique({
    where: { id: seriesId },
    select: { id: true, status: true, valorantSeriesUuid: true },
  });
  if (!series) throw new HttpError(404, "Series not found.");
  if (status && series.status !== status) {
    throw new HttpError(409, `Series is not in the ${status} state.`);
  }
  if (!series.valorantSeriesUuid) {
    throw new HttpError(409, "This series has no VALORANT series yet.");
  }
  return series;
};

const createSeries = async ({
  bindingTeamAId,
  bindingTeamBId,
  format,
  playedAt,
  ratingModePreference = null,
  anchorPlayerA,
  anchorPlayerB,
  tournamentId = null,
  actorUserId,
}) => {
  assertSupportedFormat(format);
  const anchorA = normalizeRiotId(anchorPlayerA);
  const anchorB = normalizeRiotId(anchorPlayerB);

  if (tournamentId) {
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true } });
    if (!tournament) throw new HttpError(404, "Tournament not found.");
  }

  const [bindingA, bindingB] = await Promise.all([
    prisma.valorantTeamBinding.findUnique({ where: { id: bindingTeamAId }, select: { id: true, status: true, valorantTeamUuid: true } }),
    prisma.valorantTeamBinding.findUnique({ where: { id: bindingTeamBId }, select: { id: true, status: true, valorantTeamUuid: true } }),
  ]);
  if (!bindingA || !bindingB) throw new HttpError(404, "VALORANT binding not found.");
  if (bindingA.status !== "active" || bindingB.status !== "active") {
    throw new HttpError(409, "Both teams must have active VALORANT bindings.");
  }
  if (bindingA.id === bindingB.id) {
    throw new HttpError(400, "The two series teams must be different bindings.");
  }

  const externalKey = generateExternalKey();
  const operation = await createOperation({
    type: "series_create",
    externalKey,
    actorUserId,
    requestBody: {
      team_a_id: bindingA.valorantTeamUuid,
      team_b_id: bindingB.valorantTeamUuid,
      format,
      played_at: playedAt.toISOString(),
    },
  });
  await prisma.questValorantOperation.update({
    where: { id: operation.id },
    data: { status: "in_flight" },
  });

  let response;
  try {
    response = await valorantRequest({
      method: "POST",
      path: "/api/v1/series",
      body: {
        team_a_id: bindingA.valorantTeamUuid,
        team_b_id: bindingB.valorantTeamUuid,
        format,
        importance: "regular",
        played_at: playedAt.toISOString(),
        external_quest_series_id: externalKey,
        anchor_player_a: anchorA,
        anchor_player_b: anchorB,
      },
      actorUserId,
      operationId: operation.operationId,
      externalKey,
      idempotent: true,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }

  const seriesView = mapSeriesView(response.data);
  const series = await prisma.questValorantSeries.create({
    data: {
      externalKey,
      bindingAId: bindingA.id,
      bindingBId: bindingB.id,
      format,
      playedAt,
      ratingModePreference,
      anchorPlayerAName: anchorA.name,
      anchorPlayerATag: anchorA.tag,
      anchorPlayerBName: anchorB.name,
      anchorPlayerBTag: anchorB.tag,
      status: "draft",
      valorantSeriesUuid: seriesView.id,
      lastOperationId: operation.id,
      tournamentId,
    },
  });
  await markOperationSucceeded(operation.id, response);
  return series;
};

// Manual-result series: creates AND finalizes a VALORANT series in one upstream
// call (FastAPI POST /api/v1/series/manual). No games, no anchors — the winner
// and map counts are supplied directly. The external key is DERIVED
// deterministically from the payload (see deriveManualSeriesExternalKey), so a
// retry — double-submit, or FastAPI committed before the projection was
// written — reuses the same `external_quest_series_id` and FastAPI create-or-get
// returns the existing series without re-applying ELO. The operation ledger
// carries that key so the manual call is idempotent, and the Quest projection is
// created already-finalized so it surfaces in the series list and reconciliation.
const createManualSeries = async ({
  bindingTeamAId,
  bindingTeamBId,
  format,
  playedAt,
  ratingMode,
  winnerTeamId,
  teamAMapsWon,
  teamBMapsWon,
  tournamentId = null,
  actorUserId,
}) => {
  assertSupportedFormat(format);

  if (tournamentId) {
    const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true } });
    if (!tournament) throw new HttpError(404, "Tournament not found.");
  }

  const bindingIds = [bindingTeamAId, bindingTeamBId, winnerTeamId];
  const [bindingA, bindingB, winnerBinding] = await Promise.all(
    bindingIds.map((bindingId) =>
      prisma.valorantTeamBinding.findUnique({
        where: { id: bindingId },
        select: { id: true, status: true, valorantTeamUuid: true },
      }),
    ),
  );
  if (!bindingA || !bindingB || !winnerBinding) throw new HttpError(404, "VALORANT binding not found.");
  if (bindingA.status !== "active" || bindingB.status !== "active" || winnerBinding.status !== "active") {
    throw new HttpError(409, "Both teams must have active VALORANT bindings.");
  }
  if (bindingA.id === bindingB.id) {
    throw new HttpError(400, "The two series teams must be different bindings.");
  }
  if (winnerBinding.id !== bindingA.id && winnerBinding.id !== bindingB.id) {
    throw new HttpError(400, "The winner team must be one of the two series teams.");
  }

  const externalKey = deriveManualSeriesExternalKey({
    teamAUuid: bindingA.valorantTeamUuid,
    teamBUuid: bindingB.valorantTeamUuid,
    format,
    playedAt,
    ratingMode,
    winnerUuid: winnerBinding.valorantTeamUuid,
    teamAMapsWon,
    teamBMapsWon,
  });
  const operation = await createOperation({
    type: "series_manual",
    externalKey,
    actorUserId,
    requestBody: {
      team_a_id: bindingA.valorantTeamUuid,
      team_b_id: bindingB.valorantTeamUuid,
      format,
      played_at: playedAt.toISOString(),
      rating_mode: ratingMode,
      winner_team_id: winnerBinding.valorantTeamUuid,
      team_a_maps_won: teamAMapsWon,
      team_b_maps_won: teamBMapsWon,
    },
  });
  await prisma.questValorantOperation.update({
    where: { id: operation.id },
    data: { status: "in_flight" },
  });

  let response;
  try {
    response = await valorantRequest({
      method: "POST",
      path: "/api/v1/series/manual",
      body: {
        team_a_id: bindingA.valorantTeamUuid,
        team_b_id: bindingB.valorantTeamUuid,
        format,
        played_at: playedAt.toISOString(),
        rating_mode: ratingMode,
        winner_team_id: winnerBinding.valorantTeamUuid,
        team_a_maps_won: teamAMapsWon,
        team_b_maps_won: teamBMapsWon,
        external_quest_series_id: externalKey,
      },
      actorUserId,
      operationId: operation.operationId,
      externalKey,
      idempotent: true,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }

  const result = mapManualFinalizeResult(response.data);
  // The projection write must converge (create-or-get): on a retry after the
  // upstream commit (response lost, or a double-submit raced to FastAPI), the
  // deterministic externalKey is the same, so the projection row already exists.
  // Reuse it instead of letting the unique-constraint create throw P2002 → 409 —
  // the upstream create-or-get already guaranteed single ELO application. The
  // P2002 fallback also closes the concurrent race where both requests pass the
  // findUnique above before either create commits (matches the coalescing
  // pattern in src/lib/jobs.js).
  let series = await prisma.questValorantSeries.findUnique({
    where: { externalKey },
  });
  if (!series) {
    try {
      series = await prisma.questValorantSeries.create({
        data: {
          externalKey,
          bindingAId: bindingA.id,
          bindingBId: bindingB.id,
          format,
          playedAt,
          ratingMode,
          status: "finalized",
          valorantSeriesUuid: result.seriesId,
          finalizedById: actorUserId,
          lastOperationId: operation.id,
          tournamentId,
        },
      });
    } catch (error) {
      if (error?.code === "P2002") {
        // Lost the concurrent create race — the winner's row is now committed;
        // fall through to the re-find below and return the converged row.
        series = await prisma.questValorantSeries.findUnique({
          where: { externalKey },
        });
      } else {
        // Any other projection-write failure must not leave the operation stuck
        // `in_flight` (same class as updateSeriesPlayedAt's PATCH-path fix).
        await markOperationFailed(operation.id, error);
        throw error;
      }
    }
  }
  if (!series) {
    // Defensive: a P2002 implies the winner's row committed, but if the re-find
    // still returns nothing, don't mark the operation succeeded with a null
    // series (the controller would throw on result.series.id after the fact).
    const error = new Error("Projection row missing after manual series create.");
    await markOperationFailed(operation.id, error);
    throw error;
  }
  await markOperationSucceeded(operation.id, response);
  return { ...result, series, operationId: operation.operationId };
};

const getSeries = async ({ seriesId }) => {
  const series = await prisma.questValorantSeries.findUnique({
    where: { id: seriesId },
    include: {
      bindingA: { include: { savedTeam: { select: { id: true, name: true, teamTag: true } } } },
      bindingB: { include: { savedTeam: { select: { id: true, name: true, teamTag: true } } } },
      games: { orderBy: { gameNumber: "asc" } },
      lastOperation: true,
      tournament: { select: { id: true, title: true } },
    },
  });
  if (!series) throw new HttpError(404, "Series not found.");
  return series;
};

const listSeries = async () =>
  prisma.questValorantSeries.findMany({
    include: {
      bindingA: { include: { savedTeam: { select: { id: true, name: true } } } },
      bindingB: { include: { savedTeam: { select: { id: true, name: true } } } },
      games: { select: { id: true, gameNumber: true, matchId: true, mapName: true } },
      tournament: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
  });

const deleteSeries = async ({ seriesId, actorUserId }) => {
  const series = await requireSeriesWithUuid({ seriesId, status: "draft" });
  const operation = await createOperation({
    type: "reconcile",
    questSeriesId: series.id,
    actorUserId,
    requestBody: { action: "delete_series" },
  });
  await prisma.questValorantOperation.update({ where: { id: operation.id }, data: { status: "in_flight" } });
  try {
    await valorantRequest({
      method: "DELETE",
      path: `/api/v1/series/${series.valorantSeriesUuid}`,
      actorUserId,
      operationId: operation.operationId,
      idempotent: false,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }
  await prisma.questValorantSeries.delete({ where: { id: series.id } });
  await markOperationSucceeded(operation.id, { status: 204, requestId: null, data: { seriesId: series.id } });
};

// Draft-series playedAt update (FastAPI PATCH /api/v1/series/{series_uuid}
// accepts { played_at } and returns the updated SeriesView). The Quest
// projection is written to match after the upstream PATCH commits.
const updateSeriesPlayedAt = async ({ seriesId, playedAt, actorUserId }) => {
  const series = await requireSeriesWithUuid({ seriesId, status: "draft" });
  const operation = await createOperation({
    type: "series_update",
    questSeriesId: series.id,
    actorUserId,
    requestBody: { played_at: playedAt.toISOString() },
  });
  await prisma.questValorantOperation.update({ where: { id: operation.id }, data: { status: "in_flight" } });
  let response;
  try {
    response = await valorantRequest({
      method: "PATCH",
      path: `/api/v1/series/${series.valorantSeriesUuid}`,
      body: { played_at: playedAt.toISOString() },
      actorUserId,
      operationId: operation.operationId,
      idempotent: false,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }
  const seriesView = mapSeriesView(response.data);
  let projection;
  try {
    projection = await prisma.questValorantSeries.update({
      where: { id: series.id },
      data: { playedAt, lastOperationId: operation.id },
    });
  } catch (error) {
    // The upstream PATCH already committed (idempotent by value) — a projection
    // write failure must not leave the operation stuck `in_flight`. Mark it
    // reconciliation_required (markOperationFailed on a non-FastAPI error) so the
    // retry can converge safely.
    await markOperationFailed(operation.id, error);
    throw error;
  }
  await markOperationSucceeded(operation.id, response);
  return { series: seriesView, projection };
};

const attachGame = async ({ seriesId, gameNumber, matchId, teamASide, actorUserId }) => {
  const series = await requireSeriesWithUuid({ seriesId, status: "draft" });
  // teamASide is optional: FastAPI derives the side mapping from the anchors
  // when omitted. Keep passing it through verbatim when the caller provides it.
  const attachBody = { match_id: matchId, game_number: gameNumber, ...(teamASide ? { team_a_side: teamASide } : {}) };
  const operation = await createOperation({
    type: "attach_game",
    questSeriesId: series.id,
    actorUserId,
    requestBody: attachBody,
  });
  await prisma.questValorantOperation.update({ where: { id: operation.id }, data: { status: "in_flight" } });
  let response;
  try {
    response = await valorantRequest({
      method: "POST",
      path: `/api/v1/series/${series.valorantSeriesUuid}/games`,
      body: attachBody,
      actorUserId,
      operationId: operation.operationId,
      idempotent: false,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }
  const game = mapGameView(response.data);
  const mirrored = await prisma.questValorantSeriesGame.create({
    data: {
      questSeriesId: series.id,
      gameNumber: game.gameNumber,
      matchId: game.matchId,
      valorantGameUuid: game.id,
      teamASide: game.teamASide,
      teamBSide: game.teamBSide,
      mapName: game.mapName || undefined,
    },
  });
  await markOperationSucceeded(operation.id, response);
  return mirrored;
};

const setGameOrder = async ({ seriesId, games, actorUserId }) => {
  const series = await requireSeriesWithUuid({ seriesId, status: "draft" });
  const projections = await prisma.questValorantSeriesGame.findMany({
    where: { id: { in: games.map((g) => g.gameId) }, questSeriesId: series.id },
    select: { id: true, valorantGameUuid: true },
  });
  const uuidById = new Map(projections.map((p) => [p.id, p.valorantGameUuid]));
  const bodyGames = games.map(({ gameId, gameNumber }) => {
    const vuuid = uuidById.get(gameId);
    if (!vuuid) throw new HttpError(409, "Unknown game in desired order.");
    return { game_id: vuuid, game_number: gameNumber };
  });
  const operation = await createOperation({
    type: "set_game_order",
    questSeriesId: series.id,
    actorUserId,
    requestBody: { games },
  });
  await prisma.questValorantOperation.update({ where: { id: operation.id }, data: { status: "in_flight" } });
  try {
    await valorantRequest({
      method: "PUT",
      path: `/api/v1/series/${series.valorantSeriesUuid}/games/order`,
      body: { games: bodyGames },
      actorUserId,
      operationId: operation.operationId,
      idempotent: false,
    });
    await prisma.$transaction(async (tx) => {
      // Shift existing numbers out of the way so the final assignment can't
      // collide on @@unique([questSeriesId, gameNumber]) mid-loop.
      await tx.questValorantSeriesGame.updateMany({
        where: { questSeriesId: series.id },
        data: { gameNumber: { increment: 10000 } },
      });
      for (const { gameId, gameNumber } of games) {
        await tx.questValorantSeriesGame.update({ where: { id: gameId }, data: { gameNumber } });
      }
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }
  await markOperationSucceeded(operation.id, { status: 200, requestId: null, data: { games } });
};

const removeGame = async ({ seriesId, gameId, actorUserId }) => {
  const series = await requireSeriesWithUuid({ seriesId, status: "draft" });
  const projection = await prisma.questValorantSeriesGame.findUnique({
    where: { id: gameId, questSeriesId: series.id },
    select: { id: true, valorantGameUuid: true },
  });
  if (!projection) throw new HttpError(404, "Game not found.");
  if (!projection.valorantGameUuid) throw new HttpError(409, "This game has no VALORANT game yet.");
  const operation = await createOperation({
    type: "remove_game",
    questSeriesId: series.id,
    actorUserId,
    requestBody: { game_id: gameId },
  });
  await prisma.questValorantOperation.update({ where: { id: operation.id }, data: { status: "in_flight" } });
  try {
    await valorantRequest({
      method: "DELETE",
      path: `/api/v1/series/${series.valorantSeriesUuid}/games/${projection.valorantGameUuid}`,
      actorUserId,
      operationId: operation.operationId,
      idempotent: false,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }
  await prisma.questValorantSeriesGame.delete({ where: { id: gameId } });
  await markOperationSucceeded(operation.id, { status: 204, requestId: null, data: { gameId } });
};

const previewSeries = async ({ seriesId, actorUserId }) => {
  const series = await requireSeriesWithUuid({ seriesId });
  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/series/${series.valorantSeriesUuid}/preview`,
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return mapPreview(response.data);
};

const finalizeSeries = async ({
  seriesId,
  ratingMode = null,
  officialWinnerTeamId = null,
  overrideReason = null,
  actorUserId,
  requestId,
  ipAddress,
}) => {
  const series = await prisma.questValorantSeries.findUnique({
    where: { id: seriesId },
    select: { id: true, status: true, valorantSeriesUuid: true },
  });
  if (!series) throw new HttpError(404, "Series not found.");
  if (!series.valorantSeriesUuid) throw new HttpError(409, "This series has no VALORANT series yet.");
  if (series.status === "finalized") throw new HttpError(409, "Series already finalized.");

  const operation = await createOperation({
    type: "finalize",
    questSeriesId: series.id,
    actorUserId,
    requestBody: {
      official_winner_id: officialWinnerTeamId,
      override_reason: overrideReason,
      rating_mode: ratingMode,
    },
  });
  // The intent audit is deliberately separate from QuestValorantOperation:
  // the operation row is an idempotency/reconciliation ledger, while this is
  // the durable AuditLog security event. Do not call the external mutator
  // until the intent is durably recorded.
  let resultTransactionError = null;
  try {
    await recordAudit({
      actorUserId,
      action: "valorant.series.finalize.intent",
      targetType: "QuestValorantSeries",
      targetId: series.id,
      afterData: {
        operationId: operation.operationId,
        ratingMode,
        officialWinnerTeamId,
        overrideReason,
      },
      requestId,
      ipAddress,
    });
  } catch (error) {
    await markOperationFailed(operation.id, error);
    throw error;
  }
  await prisma.questValorantOperation.update({
    where: { id: operation.id },
    data: { status: "in_flight" },
  });

  let response;
  try {
    response = await valorantRequest({
      method: "POST",
      path: `/api/v1/series/${series.valorantSeriesUuid}/finalize`,
      body: {
        official_winner_id: officialWinnerTeamId,
        override_reason: overrideReason,
        rating_mode: ratingMode,
      },
      actorUserId,
      operationId: operation.operationId,
      idempotent: false,
    });
  } catch (error) {
    if (error?.code === "SERIES_ALREADY_FINALIZED") {
      // Surface the committed state, never re-apply (spec §5.5, §8.2).
      await reconcileSeries({
        seriesId,
        actorUserId,
        requestId,
        ipAddress,
        operationId: operation.id,
        operationExternalId: operation.operationId,
        finalizeError: error,
      });
    } else {
      await markOperationFailed(operation.id, error);
    }
    throw error;
  }

  let result = null;
  let mappingError = null;
  try {
    try {
      result = mapFinalizeResult(response.data);
    } catch (error) {
      mappingError = error;
    }
    await prisma.$transaction(async (tx) => {
      const finalized = await tx.questValorantSeries.update({
        where: { id: series.id },
        data: { status: "finalized", finalizedById: actorUserId, lastOperationId: operation.id, ratingMode },
      });
      await recordAuditInTransaction(tx, {
        actorUserId,
        action: "valorant.series.finalize.result",
        targetType: "QuestValorantSeries",
        targetId: series.id,
        beforeData: { status: series.status, ratingMode: null },
        afterData: {
          status: finalized.status,
          ratingMode: finalized.ratingMode,
          operationId: operation.operationId,
          externalStatus: result?.status || null,
          externalResult: response.data,
          responseMappingError: mappingError?.message || null,
        },
        requestId,
        ipAddress,
      });
      await tx.questValorantOperation.update({
        where: { id: operation.id },
        data: {
          status: "succeeded",
          responseCode: response.status,
          fastapiRequestId: response.requestId,
          responseSummary: response.data || undefined,
          errorCode: mappingError ? "VALORANT_FINALIZE_RESPONSE_MAPPING_FAILED" : null,
        },
      });
    });
  } catch (error) {
    resultTransactionError = error;
  }
  if (resultTransactionError) {
    const error = resultTransactionError;
    await markOperationReconciliationRequired(operation.id, error, {
      responseCode: response.status ?? null,
      fastapiRequestId: response.requestId ?? null,
      upstreamCommitted: true,
      operationId: operation.operationId,
      finalize: {
        responseCode: response.status ?? null,
        requestId: response.requestId ?? null,
        responseSummary: response.data,
      },
      reconciliation: null,
      externalResult: response.data,
      responseMappingError: mappingError?.message || null,
    });
    try {
      await recordAudit({
        actorUserId,
        action: "valorant.series.finalize.result.reconciliation_required",
        targetType: "QuestValorantSeries",
        targetId: series.id,
        beforeData: { status: series.status },
        afterData: {
          status: "finalized",
          operationId: operation.operationId,
          externalResult: response.data,
          error: error?.message || "Result audit transaction failed.",
        },
        requestId,
        ipAddress,
      });
    } catch (fallbackAuditError) {
      // The operation's reconciliation record retains the raw upstream result
      // when the durable fallback AuditLog write is unavailable.
      void fallbackAuditError;
    }
    const auditError = new HttpError(503, "VALORANT finalize committed upstream; audit reconciliation is required.");
    auditError.code = "VALORANT_AUDIT_RECONCILIATION_REQUIRED";
    throw auditError;
  }
  if (mappingError) {
    const mappingResponseError = new HttpError(503, "VALORANT finalize committed and was audited, but the response could not be mapped.");
    mappingResponseError.code = "VALORANT_FINALIZE_RESPONSE_MAPPING_FAILED";
    throw mappingResponseError;
  }
  return { ...result, operationId: operation.operationId };
};

const reconcileSeries = async ({
  seriesId,
  actorUserId,
  requestId,
  ipAddress,
  operationId,
  operationExternalId,
  finalizeError,
}) => {
  const series = await prisma.questValorantSeries.findUnique({
    where: { id: seriesId },
    select: { id: true, status: true, valorantSeriesUuid: true },
  });
  if (!series) throw new HttpError(404, "Series not found.");
  if (!series.valorantSeriesUuid) throw new HttpError(409, "This series has no VALORANT series yet.");

  const trustedAlreadyFinalized = finalizeError?.code === "SERIES_ALREADY_FINALIZED";
  let response;
  try {
    response = await valorantRequest({
      method: "GET",
      path: `/api/v1/series/${series.valorantSeriesUuid}`,
      actorUserId,
      operationId: crypto.randomUUID(),
      idempotent: true,
    });
  } catch (error) {
    if (!operationId) throw error;
    const primaryResponseCode = trustedAlreadyFinalized
      ? finalizeError?.status || null
      : error?.status || null;
    const primaryRequestId = trustedAlreadyFinalized
      ? finalizeError?.requestId || null
      : error?.requestId || null;
    try {
      await runTransaction(async (tx) => {
        const current = await tx.questValorantSeries.findUnique({
          where: { id: series.id },
          select: { status: true },
        });
        await recordAuditInTransaction(tx, {
          actorUserId,
          action: "valorant.series.finalize.result.reconciliation_required",
          targetType: "QuestValorantSeries",
          targetId: series.id,
          beforeData: { status: current?.status || series.status },
          afterData: {
            operationId: operationExternalId,
            finalizeError: finalizeError?.code || finalizeError?.message || null,
            reconciliationError: error?.code || error?.message || "reconciliation read failed",
            upstreamCommitted: false,
            upstreamCommitSignal: trustedAlreadyFinalized ? finalizeError.code : null,
          },
          requestId,
          ipAddress,
        });
        await tx.questValorantOperation.update({
          where: { id: operationId },
          data: {
            status: "reconciliation_required",
            errorCode: error?.code || "VALORANT_RECONCILIATION_READ_FAILED",
            responseCode: primaryResponseCode,
            fastapiRequestId: primaryRequestId,
            responseSummary: {
              finalize: trustedAlreadyFinalized ? {
                responseCode: finalizeError?.status || null,
                requestId: finalizeError?.requestId || null,
                errorCode: finalizeError?.code || null,
                responseSummary: finalizeError?.responseSummary || null,
              } : null,
              reconciliation: {
                responseCode: error?.status || null,
                requestId: error?.requestId || null,
                errorCode: error?.code || "VALORANT_RECONCILIATION_READ_FAILED",
                responseSummary: error?.responseSummary || null,
              },
            },
          },
        });
      });
    } catch (transactionError) {
      await markOperationReconciliationRequired(operationId, transactionError, {
        responseCode: primaryResponseCode,
        fastapiRequestId: primaryRequestId,
        upstreamCommitted: false,
        upstreamCommitSignal: trustedAlreadyFinalized ? finalizeError.code : null,
        operationId: operationExternalId,
        finalize: trustedAlreadyFinalized ? {
          responseCode: finalizeError?.status || null,
          requestId: finalizeError?.requestId || null,
          errorCode: finalizeError?.code || null,
        } : null,
        finalizeError: finalizeError?.code || finalizeError?.message || null,
        reconciliationError: error?.code || error?.message || "reconciliation read failed",
        reconciliation: {
          responseCode: error?.status || null,
          requestId: error?.requestId || null,
          errorCode: error?.code || "VALORANT_RECONCILIATION_READ_FAILED",
          responseSummary: error?.responseSummary || null,
        },
      });
    }
    throw new HttpError(503, "VALORANT finalize committed upstream; reconciliation is required.");
  }

  let view = null;
  let mappingError = null;
  try {
    view = mapSeriesView(response.data);
  } catch (error) {
    mappingError = error;
  }

  if (view?.status === "finalized" || (mappingError && trustedAlreadyFinalized)) {
    let transactionError = null;
    try {
      await runTransaction(async (tx) => {
        const current = await tx.questValorantSeries.findUnique({
          where: { id: series.id },
          select: { id: true, status: true, ratingMode: true },
        });
        if (!current) throw new HttpError(404, "Series not found.");
        const finalized = await tx.questValorantSeries.update({
          where: { id: series.id },
          data: {
            status: "finalized",
            finalizedById: actorUserId,
            lastOperationId: operationId || undefined,
            ratingMode: view?.ratingMode ?? current.ratingMode,
          },
        });
        await recordAuditInTransaction(tx, {
          actorUserId,
          action: "valorant.series.finalize.result",
          targetType: "QuestValorantSeries",
          targetId: series.id,
          beforeData: { status: current.status, ratingMode: current.ratingMode },
          afterData: {
            status: finalized.status,
            ratingMode: finalized.ratingMode,
            operationId: operationExternalId,
            externalStatus: view?.status || null,
            externalResult: response.data,
            responseMappingError: mappingError?.message || null,
            reconciled: true,
            finalizeResponse: trustedAlreadyFinalized ? {
              responseCode: finalizeError?.status || null,
              requestId: finalizeError?.requestId || null,
              errorCode: finalizeError?.code || null,
            } : null,
            reconciliationResponse: {
              responseCode: response.status,
              requestId: response.requestId || null,
            },
          },
          requestId,
          ipAddress,
        });
        if (operationId) {
          await tx.questValorantOperation.update({
            where: { id: operationId },
            data: {
              status: "succeeded",
              responseCode: trustedAlreadyFinalized ? finalizeError?.status || null : response.status,
              fastapiRequestId: trustedAlreadyFinalized ? finalizeError?.requestId || null : response.requestId,
              responseSummary: trustedAlreadyFinalized ? {
                finalize: {
                  responseCode: finalizeError?.status || null,
                  requestId: finalizeError?.requestId || null,
                  errorCode: finalizeError?.code || null,
                  responseSummary: finalizeError?.responseSummary || null,
                },
                reconciliation: {
                  responseCode: response.status,
                  requestId: response.requestId || null,
                  data: response.data,
                },
              } : response.data || undefined,
              errorCode: mappingError ? "VALORANT_FINALIZE_RESPONSE_MAPPING_FAILED" : "SERIES_ALREADY_FINALIZED",
            },
          });
        }
      });
    } catch (error) {
      transactionError = error;
    }
    if (transactionError) {
      if (operationId) {
        await markOperationReconciliationRequired(operationId, transactionError, {
          responseCode: trustedAlreadyFinalized ? finalizeError?.status || null : response.status,
          fastapiRequestId: trustedAlreadyFinalized ? finalizeError?.requestId || null : response.requestId || null,
          upstreamCommitted: true,
          operationId: operationExternalId,
          finalize: trustedAlreadyFinalized ? {
            responseCode: finalizeError?.status || null,
            requestId: finalizeError?.requestId || null,
            errorCode: finalizeError?.code || null,
          } : null,
          reconciliation: {
            responseCode: response.status,
            requestId: response.requestId || null,
          },
          externalResult: response.data,
          responseMappingError: mappingError?.message || null,
        });
      }
      try {
        await recordAudit({
          actorUserId,
          action: "valorant.series.finalize.result.reconciliation_required",
          targetType: "QuestValorantSeries",
          targetId: series.id,
          beforeData: { status: series.status },
          afterData: {
            status: "finalized",
            operationId: operationExternalId,
            externalResult: response.data,
            responseMappingError: mappingError?.message || null,
            error: transactionError.message,
          },
          requestId,
          ipAddress,
        });
      } catch (fallbackAuditError) {
        void fallbackAuditError;
      }
      throw new HttpError(503, "VALORANT finalize committed upstream; audit reconciliation is required.");
    }
    if (mappingError) {
      const mappingResponseError = new HttpError(503, "VALORANT finalize committed and was audited, but the response could not be mapped.");
      mappingResponseError.code = "VALORANT_FINALIZE_RESPONSE_MAPPING_FAILED";
      throw mappingResponseError;
    }
    return view;
  }

  const reconciliationError = new HttpError(503, "VALORANT finalize could not confirm the committed upstream result.");
  reconciliationError.code = "VALORANT_FINALIZE_RECONCILIATION_REQUIRED";
  if (operationId) {
    let transactionError = null;
    try {
      await runTransaction(async (tx) => {
        const current = await tx.questValorantSeries.findUnique({
          where: { id: series.id },
          select: { status: true },
        });
        await recordAuditInTransaction(tx, {
          actorUserId,
          action: "valorant.series.finalize.result.reconciliation_required",
          targetType: "QuestValorantSeries",
          targetId: series.id,
          beforeData: { status: current?.status || series.status },
          afterData: {
            status: current?.status || series.status,
            operationId: operationExternalId,
            externalStatus: view?.status || null,
            externalResult: response.data,
            finalizeError: finalizeError?.code || finalizeError?.message || null,
            upstreamCommitted: false,
          },
          requestId,
          ipAddress,
        });
        await tx.questValorantOperation.update({
          where: { id: operationId },
          data: {
            status: "reconciliation_required",
            errorCode: reconciliationError.code,
            responseCode: trustedAlreadyFinalized ? finalizeError?.status || null : null,
            fastapiRequestId: trustedAlreadyFinalized ? finalizeError?.requestId || null : null,
            responseSummary: {
              finalize: trustedAlreadyFinalized ? {
                responseCode: finalizeError?.status || null,
                requestId: finalizeError?.requestId || null,
                errorCode: finalizeError?.code || null,
                responseSummary: finalizeError?.responseSummary || null,
              } : null,
              reconciliation: {
                responseCode: response.status,
                requestId: response.requestId || null,
                data: response.data,
              },
            },
          },
        });
      });
    } catch (error) {
      transactionError = error;
    }
    if (transactionError) {
      await markOperationReconciliationRequired(operationId, transactionError, {
        responseCode: trustedAlreadyFinalized ? finalizeError?.status || null : null,
        fastapiRequestId: trustedAlreadyFinalized ? finalizeError?.requestId || null : null,
        upstreamCommitted: false,
        upstreamCommitSignal: trustedAlreadyFinalized ? finalizeError.code : null,
        operationId: operationExternalId,
        externalResult: response.data,
        externalStatus: view?.status || null,
        finalize: trustedAlreadyFinalized ? {
          responseCode: finalizeError?.status || null,
          requestId: finalizeError?.requestId || null,
          errorCode: finalizeError?.code || null,
        } : null,
        reconciliation: {
          responseCode: response.status,
          requestId: response.requestId || null,
        },
      });
      try {
        await recordAudit({
          actorUserId,
          action: "valorant.series.finalize.result.reconciliation_required",
          targetType: "QuestValorantSeries",
          targetId: series.id,
          beforeData: { status: series.status },
          afterData: {
            operationId: operationExternalId,
            externalStatus: view?.status || null,
            externalResult: response.data,
            error: transactionError.message,
          },
          requestId,
          ipAddress,
        });
      } catch (fallbackAuditError) {
        void fallbackAuditError;
      }
    }
  }
  throw reconciliationError;
};

const getRankings = async ({ actorUserId }) => {
  const response = await valorantRequest({
    method: "GET",
    path: "/api/v1/rankings/teams",
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return (response.data || []).map(mapRankingEntry);
};

const getRatingHistory = async ({ teamId, actorUserId }) => {
  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/teams/${encodeURIComponent(teamId)}/rating-history`,
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return (response.data || []).map(mapRatingEvent);
};

const getTeamSeries = async ({ teamId, actorUserId }) => {
  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/teams/${encodeURIComponent(teamId)}/series`,
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  return (response.data || []).map(mapSeriesView);
};

const getReconciliationReport = async ({ actorUserId }) => {
  const [questSeries, bindings, matchProjections, stuckOperations] = await Promise.all([
    prisma.questValorantSeries.findMany({ select: { id: true, externalKey: true, valorantSeriesUuid: true, status: true } }),
    prisma.valorantTeamBinding.findMany({ select: { id: true, savedTeamId: true, valorantTeamUuid: true, status: true } }),
    prisma.questValorantMatch.findMany({ select: { id: true, matchId: true, henrikMatchId: true } }),
    prisma.questValorantOperation.findMany({
      where: { status: { in: ["in_flight", "reconciliation_required"] } },
      select: { id: true, operationId: true, type: true, status: true, questSeriesId: true },
    }),
  ]);

  const seriesByUuid = new Map(questSeries.filter((s) => s.valorantSeriesUuid).map((s) => [s.valorantSeriesUuid, s]));
  const seriesUuids = [...seriesByUuid.keys()];

  // Single read of the FastAPI series list covers both directions (§8.3).
  const fastapiSeries = seriesUuids.length
    ? await valorantRequest({
        method: "GET",
        path: "/api/v1/series",
        actorUserId,
        operationId: crypto.randomUUID(),
        idempotent: true,
      })
    : { data: [] };

  const fastapiByUuid = new Map((fastapiSeries.data || []).map((s) => [s.id, s]));
  const fastapiByExternalKey = new Map((fastapiSeries.data || []).map((s) => [s.external_quest_series_id, s]));
  const questKeys = new Set(questSeries.map((s) => s.externalKey));

  const orphaned = questSeries.filter(
    (s) =>
      !(s.valorantSeriesUuid && fastapiByUuid.has(s.valorantSeriesUuid)) &&
      !(s.externalKey && fastapiByExternalKey.has(s.externalKey)),
  );
  const unprojected = (fastapiSeries.data || [])
    .filter((s) => !questKeys.has(s.external_quest_series_id))
    .map((s) => ({ id: s.id, externalQuestSeriesId: s.external_quest_series_id || null }));

  const teamMissing = [];
  for (const binding of bindings) {
    try {
      await valorantRequest({
        method: "GET",
        path: `/api/v1/teams/${encodeURIComponent(binding.valorantTeamUuid)}`,
        actorUserId,
        operationId: crypto.randomUUID(),
        idempotent: true,
      });
    } catch (error) {
      if (error instanceof FastApiError && error.code === "TEAM_NOT_FOUND") teamMissing.push(binding);
    }
  }

  const matchMissing = [];
  for (const projection of matchProjections) {
    try {
      await valorantRequest({
        method: "GET",
        path: `/api/v1/matches/${encodeURIComponent(projection.matchId)}`,
        actorUserId,
        operationId: crypto.randomUUID(),
        idempotent: true,
      });
    } catch (error) {
      if (error instanceof FastApiError && error.code === "MATCH_NOT_FOUND") matchMissing.push(projection);
    }
  }

  return { orphaned, unprojected, teamMissing, matchMissing, stuckOperations };
};

module.exports = {
  createOperation,
  markOperationSucceeded,
  markOperationFailed,
  markOperationReconciliationRequired,
  listBindings,
  listTeams,
  bindTeam,
  detachBinding,
  discover,
  importMatch,
  getMatchByHenrikId,
  listMatches,
  listSeriesMatches,
  upsertMatchProjection,
  requireSeriesWithUuid,
  createSeries,
  createManualSeries,
  getSeries,
  listSeries,
  deleteSeries,
  updateSeriesPlayedAt,
  attachGame,
  setGameOrder,
  removeGame,
  previewSeries,
  finalizeSeries,
  reconcileSeries,
  getReconciliationReport,
  getRankings,
  getRatingHistory,
  getTeamSeries,
};
