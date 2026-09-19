const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { recordAudit, recordAuditInTransaction } = require("../../lib/audit");
const { valorantRequest, FastApiError } = require("./valorant.client");
const { mapSeriesView } = require("./valorant.mapper");
const { runTransaction, markOperationReconciliationRequired } = require("./valorant-operations");

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
  reconcileSeries,
  getReconciliationReport,
};
