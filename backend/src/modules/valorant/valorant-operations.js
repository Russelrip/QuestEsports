const crypto = require("crypto");
const { prisma } = require("../../lib/prisma");
const { FastApiError } = require("./valorant.client");

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

module.exports = {
  runTransaction,
  createOperation,
  markOperationSucceeded,
  markOperationFailed,
  markOperationReconciliationRequired,
};
