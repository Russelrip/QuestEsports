const crypto = require("crypto");
const { valorantRequest, FastApiError, InternalServiceError } = require("../valorant/valorant.client");
const { logger } = require("../../lib/logger");

// The VALORANT platform backend already owns Riot account resolution: it is the
// only component that speaks to HenrikDev, and `POST /api/v1/players/resolve`
// returns the stable PUUID plus the current display identity. Quest never adds
// a second Riot integration — this module is a thin, authenticated caller.
//
// Reads write no operation-ledger row (only mutations do), but the service
// token still carries the acting user so the upstream request is attributable.
const resolveRiotAccount = async ({ name, tag, actorUserId }) => {
  const { data } = await valorantRequest({
    method: "POST",
    path: "/api/v1/players/resolve",
    body: { name, tag },
    actorUserId,
    operationId: crypto.randomUUID(),
    idempotent: true,
  });

  return {
    externalId: String(data?.puuid || ""),
    username: data?.name ?? null,
    tagline: data?.tag ?? null,
    region: data?.affinity ?? null,
    platforms: Array.isArray(data?.platforms) ? data.platforms : [],
  };
};

// Rank/peak/last-played for the confirmation card. Strictly an enrichment: a
// player must be able to link an account when the stats endpoint is degraded,
// so every failure here resolves to null rather than propagating.
const fetchPlayerPreview = async ({ externalId, actorUserId }) => {
  try {
    const { data } = await valorantRequest({
      method: "POST",
      path: "/api/v1/register/preview",
      body: { puuid: externalId },
      actorUserId,
      operationId: crypto.randomUUID(),
      idempotent: true,
    });
    return data ?? null;
  } catch (error) {
    logger.warn("VALORANT player preview unavailable; continuing without it.", {
      code: error?.code || null,
      status: error?.status || null,
    });
    return null;
  }
};

module.exports = {
  resolveRiotAccount,
  fetchPlayerPreview,
  FastApiError,
  InternalServiceError,
};
