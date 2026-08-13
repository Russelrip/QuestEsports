const { env } = require("../../config/env");
const { buildServiceAuthHeaders } = require("./valorant.auth");

const CONNECT_TIMEOUT_MS = 10000;
const RETRY_BASE_DELAY_MS = 500;

class FastApiError extends Error {
  constructor(message, { code, status, requestId = null, responseSummary = null } = {}) {
    super(message);
    this.name = "FastApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.responseSummary = responseSummary;
  }
}

class InternalServiceError extends Error {
  constructor(message, { code = "valorant_unreachable", status = 502, requestId = null } = {}) {
    super(message);
    this.name = "InternalServiceError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

// Quest surface for every observed FastAPI error code (spec §6.5). Add a row
// only when a new code is observed and fixture-recorded — never by assumption.
const VALORANT_ERROR_MESSAGES = {
  ADMIN_AUTH_REQUIRED: "VALORANT platform rejected the request (service auth)",
  INVALID_REQUEST: "Invalid request — check the form values",
  INVALID_RIOT_ID: "Invalid Riot ID or player identifier",
  PLAYER_NOT_FOUND: "Riot ID could not be resolved",
  PLAYER_REGION_UNKNOWN: "Riot ID could not be resolved",
  HENRIK_AUTH_FAILED: "VALORANT provider auth failed — contact admin",
  HENRIK_RATE_LIMITED: "VALORANT provider is rate limited — retry shortly",
  HENRIK_UNAVAILABLE: "VALORANT platform unavailable — contact admin",
  HENRIK_VALIDATION_ERROR: "VALORANT provider rejected the search filters",
  MATCH_NOT_FOUND: "Match not found",
  MATCH_NOT_COMPLETED: "Match is not completed",
  MATCH_ALREADY_ASSIGNED_TO_SERIES: "This match is already used in another series",
  MATCH_REFRESH_REJECTED: "This match cannot be refreshed (finalized series)",
  TEAM_NOT_FOUND: "VALORANT team not found",
  TEAM_SLUG_TAKEN: "Team slug already taken",
  SERIES_NOT_FOUND: "Series not found",
  SERIES_INVALID: "Series shape is invalid",
  SERIES_ALREADY_FINALIZED: "Series already finalized",
  RATING_POLICY_REQUIRED: "Choose an explicit rating policy and reason",
  INVALID_SIDE_MAPPING: "Invalid side mapping",
  ANCHOR_MISMATCH: "Anchor player not verified on one side of a map — override required",
  BACKDATED_SERIES_REJECTED: "Cannot rate a series older than the latest rated series",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const valorantRequest = async ({
  method,
  path,
  body = null,
  actorUserId,
  operationId,
  externalKey = null,
  idempotent = false,
}) => {
  const baseUrl = env.VALORANT_INTERNAL_BASE_URL;
  if (!baseUrl) {
    throw new InternalServiceError("VALORANT internal service is not configured.", {
      code: "valorant_not_configured",
      status: 503,
    });
  }

  const headers = {
    ...buildServiceAuthHeaders({ actorUserId, operationId, externalKey }),
    "Content-Type": "application/json",
  };
  const readTimeoutMs = env.VALORANT_TIMEOUT_MS || 15000;
  const maxAttempts = idempotent ? 1 + env.VALORANT_READ_RETRIES : 1;
  const url = `${baseUrl}${path}`;

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const controller = new AbortController();
    const connectTimer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (attempt < maxAttempts && error?.name !== "AbortError") {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      throw new InternalServiceError("VALORANT platform could not be reached.", {
        code: "valorant_unreachable",
        status: 502,
      });
    } finally {
      clearTimeout(connectTimer);
    }

    const readTimer = setTimeout(() => controller.abort(), readTimeoutMs);
    let payload = null;
    try {
      const text = await response.text();
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
      }
    } catch (error) {
      if (error?.name === "AbortError" && attempt < maxAttempts) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      throw new InternalServiceError("VALORANT platform could not be reached.", {
        code: "valorant_unreachable",
        status: 502,
      });
    } finally {
      clearTimeout(readTimer);
    }

    const requestId = response.headers.get("x-request-id") || null;

    if (response.ok) {
      return { status: response.status, data: payload, requestId };
    }

    // Retry decision is STATUS-based (spec §6.6): bounded retries for
    // idempotent reads on transient 429/5xx. This must be evaluated BEFORE
    // the error-code mapping so a 5xx carrying a code (e.g. INTERNAL_ERROR)
    // is retried rather than thrown immediately.
    const hasRetryAfter = Boolean(response.headers.get("retry-after"));
    const retryable = (response.status === 429 && hasRetryAfter) || response.status >= 500;
    if (attempt < maxAttempts && retryable) {
      await sleep(RETRY_BASE_DELAY_MS * attempt);
      continue;
    }

    const errorCode = payload?.error?.code;
    if (typeof errorCode === "string") {
      throw new FastApiError(
        VALORANT_ERROR_MESSAGES[errorCode] || payload?.error?.message || "VALORANT platform rejected the request.",
        {
          code: errorCode,
          status: response.status,
          requestId,
          responseSummary: { code: errorCode, message: payload?.error?.message },
        },
      );
    }

    throw new InternalServiceError("VALORANT platform returned an error.", {
      code: "valorant_upstream_error",
      status: 502,
      requestId,
    });
  }
};

module.exports = {
  valorantRequest,
  FastApiError,
  InternalServiceError,
  VALORANT_ERROR_MESSAGES,
};
