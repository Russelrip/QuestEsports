const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { valorantRequest, FastApiError } = require("./valorant.client");
const { mapTeamResponse, mapMatchCandidate, mapMatchSummary, mapMatchDetail, mapSeriesView, mapGameView, mapPreview, mapFinalizeResult, mapRankingEntry, mapRatingEvent } = require("./valorant.mapper");
const { normalizeRiotId, generateExternalKey, assertSupportedFormat } = require("./valorant.validation");

const hashRequestBody = (body) =>
  crypto.createHash("sha256").update(JSON.stringify(body || {})).digest("hex");

const createOperation = async ({ type, externalKey = null, questSeriesId = null, actorUserId, requestBody = null }) =>
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
    data: { status: "reconciliation_required" },
  });
};

const markOperationReconciliationRequired = async (operationId, error) =>
  prisma.questValorantOperation.update({
    where: { id: operationId },
    data: {
      status: "reconciliation_required",
      errorCode: error?.code || "valorant_unreachable",
      fastapiRequestId: error?.requestId || null,
    },
  });

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

const bindTeam = async ({ savedTeamId, actorUserId, requestId, ipAddress }) => {
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

const detachBinding = async ({ bindingId, actorUserId, requestId, ipAddress }) => {
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
  requestId,
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

const upsertMatchProjection = (detail) => {
  const mapped = mapMatchDetail(detail);
  return prisma.questValorantMatch.upsert({
    where: { henrikMatchId: mapped.henrikMatchId },
    create: {
      matchId: mapped.matchId,
      henrikMatchId: mapped.henrikMatchId,
      mapName: mapped.mapName,
      startedAt: new Date(mapped.startedAt),
      mode: mapped.mode || undefined,
      queue: mapped.queue || undefined,
      redScore: mapped.redScore ?? undefined,
      blueScore: mapped.blueScore ?? undefined,
      winningSide: mapped.winningSide || undefined,
      rosterSummary: { players: mapped.players },
      lastSyncedAt: new Date(),
    },
    update: {
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
    },
  });
};

const importMatch = async ({ henrikMatchId, affinity = "eu", actorUserId, requestId, ipAddress }) => {
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
  requestId,
  ipAddress,
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

const deleteSeries = async ({ seriesId, actorUserId, requestId, ipAddress }) => {
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

const attachGame = async ({ seriesId, gameNumber, matchId, teamASide, actorUserId, requestId, ipAddress }) => {
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

const setGameOrder = async ({ seriesId, games, actorUserId, requestId, ipAddress }) => {
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

const removeGame = async ({ seriesId, gameId, actorUserId, requestId, ipAddress }) => {
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
    await markOperationFailed(operation.id, error);
    if (error?.code === "SERIES_ALREADY_FINALIZED") {
      // Surface the committed state, never re-apply (spec §5.5, §8.2).
      await reconcileSeries({ seriesId, actorUserId, requestId, ipAddress });
    }
    throw error;
  }

  const result = mapFinalizeResult(response.data);
  await prisma.questValorantSeries.update({
    where: { id: series.id },
    data: { status: "finalized", finalizedById: actorUserId, lastOperationId: operation.id, ratingMode },
  });
  await markOperationSucceeded(operation.id, response);
  return { ...result, operationId: operation.operationId };
};

const reconcileSeries = async ({ seriesId, actorUserId, requestId, ipAddress }) => {
  const series = await prisma.questValorantSeries.findUnique({
    where: { id: seriesId },
    select: { id: true, status: true, valorantSeriesUuid: true },
  });
  if (!series) throw new HttpError(404, "Series not found.");
  if (!series.valorantSeriesUuid) throw new HttpError(409, "This series has no VALORANT series yet.");

  const response = await valorantRequest({
    method: "GET",
    path: `/api/v1/series/${series.valorantSeriesUuid}`,
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });
  const view = mapSeriesView(response.data);

  if (view.status === "finalized") {
    return prisma.questValorantSeries.update({
      where: { id: series.id },
      data: { status: "finalized", finalizedById: actorUserId, lastOperationId: undefined, ratingMode: view.ratingMode },
    });
  }
  // FastAPI still reports draft: the finalize transaction rolled back; a fresh
  // finalize with the same inputs is safe (double-finalize is rejected server-side).
  return prisma.questValorantSeries.update({
    where: { id: series.id },
    data: { status: series.status === "reconciliation_required" ? "draft" : series.status },
  });
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
  getSeries,
  listSeries,
  deleteSeries,
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
