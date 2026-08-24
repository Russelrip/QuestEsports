const crypto = require("node:crypto");
const { env } = require("../../config/env");
const { HttpError } = require("../../lib/http-error");
const { buildServiceAuthHeaders } = require("../valorant/valorant.auth");

const TIMEOUT_MS = 5000;
// preview/submit and the Discord callback hit Henrik/Discord upstream, which is
// slower and rate-limited — a 5s abort would cause spurious 503s. Matches the
// admin client's CONNECT_TIMEOUT_MS.
const REGISTRATION_TIMEOUT_MS = 60000;

const getBaseUrl = () => {
  const baseUrl = env.VALORANT_INTERNAL_BASE_URL;
  if (!baseUrl) {
    throw new HttpError(503, "VALORANT leaderboard is not configured.");
  }
  return baseUrl.replace(/\/+$/, "");
};

const request = async ({ path, method = "GET", body = null, timeoutMs = TIMEOUT_MS }) => {
  const baseUrl = getBaseUrl();
  const systemActor = env.QUEST_LEADERBOARD_SYSTEM_ACTOR;
  if (!systemActor) {
    throw new HttpError(503, "VALORANT leaderboard is not configured.");
  }
  const headers = {
    ...buildServiceAuthHeaders({
      actorUserId: systemActor,
      operationId: crypto.randomUUID(),
    }),
    ...(body === null ? {} : { "Content-Type": "application/json" }),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new HttpError(503, "VALORANT leaderboard is unavailable.");
  } finally {
    clearTimeout(timer);
  }
  return response;
};

// Coarse mapping kept for the legacy leaderboard endpoints (no behavior change).
const get = async (path) => {
  const response = await request({ path });
  if (response.ok) {
    return response.json();
  }
  if (response.status === 404) {
    throw new HttpError(404, "Leaderboard page not found.");
  }
  throw new HttpError(502, "VALORANT leaderboard is unavailable.");
};

// Shared handler for the registration/auth flow: propagate the upstream status
// and message. Upstream errors are { "error": { code, message, request_id } } —
// but some failures (e.g. require_service_token) serialize as
// { "detail": { "error": {...} } }; read both shapes. Fall back to the code
// when no message is present.
const propagateUpstreamError = async (response) => {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const upstreamError = payload?.error || payload?.detail?.error;
  const message = upstreamError?.message || upstreamError?.code;
  if (typeof message === "string" && message.length > 0) {
    throw new HttpError(response.status, message);
  }
  if (response.status === 404) {
    throw new HttpError(404, "Leaderboard page not found.");
  }
  throw new HttpError(502, "VALORANT leaderboard is unavailable.");
};

const requestJson = async ({ path, method = "GET", body = null, timeoutMs = TIMEOUT_MS }) => {
  const response = await request({ path, method, body, timeoutMs });
  if (response.ok) {
    return response.json();
  }
  return propagateUpstreamError(response);
};

const post = async (path, body, timeoutMs = TIMEOUT_MS) =>
  requestJson({ path, method: "POST", body, timeoutMs });

const getLeaderboard = async ({ page = 1, perPage = 50 }) => {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  return get(`/api/v1/leaderboard?${params.toString()}`);
};

// A query that matches nobody is a normal result, not an outage: upstream
// answers 200 `null` today, but a 404 means the same thing. Both become null so
// the page can render "no player found" instead of "leaderboard unavailable".
const searchLeaderboard = async (query) => {
  const response = await request({ path: `/api/v1/leaderboard/search/${encodeURIComponent(query)}` });
  if (response.ok) {
    return response.json();
  }
  if (response.status === 404) {
    return null;
  }
  throw new HttpError(502, "VALORANT leaderboard is unavailable.");
};

// Registration + auth proxy endpoints (valorant-platform-backend).
const getDiscordLogin = async () =>
  requestJson({ path: "/api/v1/auth/discord/login", timeoutMs: REGISTRATION_TIMEOUT_MS });

const getDiscordCallback = async (code) =>
  requestJson({
    path: `/api/v1/auth/discord/callback?code=${encodeURIComponent(code)}`,
    timeoutMs: REGISTRATION_TIMEOUT_MS,
  });

const checkPuuid = async (puuid) =>
  post("/api/v1/auth/check-puuid", { puuid }, REGISTRATION_TIMEOUT_MS);

// Stable Discord account id -> upstream leaderboard registration, if any. The
// upstream keeps `leaderboard_players.discord_id` under a partial-unique index,
// which is what makes this usable as a corroborating signal for account
// linking. Never keyed on the mutable Discord username.
const checkDiscord = async (discordId) =>
  post("/api/v1/auth/check-discord", { discord_id: discordId }, REGISTRATION_TIMEOUT_MS);

const previewRegistration = async (puuid) =>
  post("/api/v1/register/preview", { puuid }, REGISTRATION_TIMEOUT_MS);

const submitRegistration = async (input) =>
  post("/api/v1/register/submit", input, REGISTRATION_TIMEOUT_MS);

module.exports = {
  getLeaderboard,
  searchLeaderboard,
  getDiscordLogin,
  getDiscordCallback,
  checkPuuid,
  checkDiscord,
  previewRegistration,
  submitRegistration,
};
