const crypto = require("node:crypto");
const { env } = require("../../config/env");
const { HttpError } = require("../../lib/http-error");
const { buildServiceAuthHeaders } = require("../valorant/valorant.auth");

const TIMEOUT_MS = 5000;

const getBaseUrl = () => {
  const baseUrl = env.VALORANT_INTERNAL_BASE_URL;
  if (!baseUrl) {
    throw new HttpError(503, "VALORANT leaderboard is not configured.");
  }
  return baseUrl.replace(/\/+$/, "");
};

const request = async ({ path, method = "GET", body = null }) => {
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
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
// and message. Upstream errors are { "error": { code, message, request_id } };
// fall back to the code when no message is present.
const propagateUpstreamError = async (response) => {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const upstreamError = payload?.error;
  const message = upstreamError?.message || upstreamError?.code;
  if (typeof message === "string" && message.length > 0) {
    throw new HttpError(response.status, message);
  }
  if (response.status === 404) {
    throw new HttpError(404, "Leaderboard page not found.");
  }
  throw new HttpError(502, "VALORANT leaderboard is unavailable.");
};

const requestJson = async ({ path, method = "GET", body = null }) => {
  const response = await request({ path, method, body });
  if (response.ok) {
    return response.json();
  }
  return propagateUpstreamError(response);
};

const post = async (path, body) => requestJson({ path, method: "POST", body });

const getLeaderboard = async ({ page = 1, perPage = 50 }) => {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  return get(`/api/v1/leaderboard?${params.toString()}`);
};

const searchLeaderboard = async (query) =>
  get(`/api/v1/leaderboard/search/${encodeURIComponent(query)}`);

// Registration + auth proxy endpoints (valorant-platform-backend).
const getDiscordLogin = async () => requestJson({ path: "/api/v1/auth/discord/login" });

const getDiscordCallback = async (code) =>
  requestJson({ path: `/api/v1/auth/discord/callback?code=${encodeURIComponent(code)}` });

const checkPuuid = async (puuid) => post("/api/v1/auth/check-puuid", { puuid });

const previewRegistration = async (puuid) => post("/api/v1/register/preview", { puuid });

const submitRegistration = async (input) => post("/api/v1/register/submit", input);

module.exports = {
  getLeaderboard,
  searchLeaderboard,
  getDiscordLogin,
  getDiscordCallback,
  checkPuuid,
  previewRegistration,
  submitRegistration,
};
