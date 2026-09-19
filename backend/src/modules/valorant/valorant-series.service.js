const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { recordAudit, recordAuditInTransaction } = require("../../lib/audit");
const { valorantRequest } = require("./valorant.client");
const {
  mapSeriesView,
  mapGameView,
  mapPreview,
  mapFinalizeResult,
  mapManualFinalizeResult,
} = require("./valorant.mapper");
const {
  normalizeRiotId,
  generateExternalKey,
  assertSupportedFormat,
  deriveManualSeriesExternalKey,
} = require("./valorant.validation");
const {
  createOperation,
  markOperationSucceeded,
  markOperationFailed,
  markOperationReconciliationRequired,
} = require("./valorant-operations");
const { reconcileSeries } = require("./valorant-reconcile.service");

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

module.exports = {
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
};
