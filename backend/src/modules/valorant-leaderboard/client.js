const crypto = require("node:crypto");
const { env } = require("../../config/env");
const { HttpError } = require("../../lib/http-error");
const { buildServiceAuthHeaders } = require("../valorant/valorant.auth");

const TIMEOUT_MS = 5000;
const REGISTRATION_TIMEOUT_MS = 60000;

const getBaseUrl = () => {
  const baseUrl = env.VALORANT_INTERNAL_BASE_URL;
  if (!baseUrl) {
    throw new HttpError(503, "VALORANT leaderboard is not configured.");
  }
  return baseUrl.replace(/\/+$/, "");
};

// Public reads and self-service registration act as the system actor. Admin
// calls pass the admin's own id so the upstream token names who acted.
const request = async ({ path, method = "GET", body = null, timeoutMs = TIMEOUT_MS, actorUserId = null }) => {
  const baseUrl = getBaseUrl();
  const actor = actorUserId || env.QUEST_LEADERBOARD_SYSTEM_ACTOR;
  if (!actor) {
    throw new HttpError(503, "VALORANT leaderboard is not configured.");
  }
  const headers = {
    ...buildServiceAuthHeaders({
      actorUserId: actor,
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

const requestJson = async ({ path, method = "GET", body = null, timeoutMs = TIMEOUT_MS, actorUserId = null }) => {
  const response = await request({ path, method, body, timeoutMs, actorUserId });
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

const checkPuuid = async (puuid) =>
  post("/api/v1/auth/check-puuid", { puuid }, REGISTRATION_TIMEOUT_MS);

// Used by Quest game-account linking as a corroborating signal. This is an
// internal upstream lookup, not a public leaderboard registration route.
const checkDiscord = async (discordId) =>
  post("/api/v1/auth/check-discord", { discord_id: discordId }, REGISTRATION_TIMEOUT_MS);

const previewRegistration = async (puuid) =>
  post("/api/v1/register/preview", { puuid }, REGISTRATION_TIMEOUT_MS);

const submitRegistration = async (input) =>
  post("/api/v1/register/submit", input, REGISTRATION_TIMEOUT_MS);

// Move an existing registration to a different account. Only called after an
// admin has approved the move on the Quest side: the upstream carries the
// decision out, it does not make it.
const repointRegistration = async (input) =>
  requestJson({
    path: "/api/v1/register",
    method: "PUT",
    body: input,
    timeoutMs: REGISTRATION_TIMEOUT_MS,
  });

// Admin: every registration, including the ones the public board filters out.
const listRegistrations = async ({ query = "", page = 1, perPage = 50, actorUserId }) => {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  return requestJson({ path: `/api/v1/leaderboard/players?${params.toString()}`, actorUserId });
};

// Admin: delete one registration. Resolves to the row as it was, with the
// `removal_id` of the copy upstream keeps so the removal can be restored.
const removeRegistration = async ({ puuid, actorUserId }) =>
  requestJson({
    path: `/api/v1/leaderboard/players/${encodeURIComponent(puuid)}`,
    method: "DELETE",
    actorUserId,
  });

// Admin: removed registrations, newest first, with whether each can be restored.
const listRemovals = async ({ query = "", page = 1, perPage = 20, actorUserId }) => {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  return requestJson({ path: `/api/v1/leaderboard/removals?${params.toString()}`, actorUserId });
};

// Admin: put a removed registration back exactly as it was. Upstream refuses
// with 409 when it cannot (already restored, registered again, Discord taken).
const restoreRemoval = async ({ removalId, actorUserId }) =>
  requestJson({
    path: `/api/v1/leaderboard/removals/${encodeURIComponent(removalId)}/restore`,
    method: "POST",
    actorUserId,
  });

// Admin: ban a registered player's Riot and Discord accounts. Upstream removes
// every registration holding either, in the same transaction as the ban.
const banRegistration = async ({ puuid, reason, actorUserId }) =>
  requestJson({
    path: `/api/v1/leaderboard/players/${encodeURIComponent(puuid)}/ban`,
    method: "POST",
    body: { reason },
    actorUserId,
  });

// Admin: ban an already-removed player by the accounts the removal kept.
// Upstream refuses with 409 when both are already banned.
const banRemoval = async ({ removalId, reason, actorUserId }) =>
  requestJson({
    path: `/api/v1/leaderboard/removals/${encodeURIComponent(removalId)}/ban`,
    method: "POST",
    body: { reason },
    actorUserId,
  });

// Admin: bans newest first — "active" (the default upstream), "lifted" or "all".
const listBans = async ({ status = "active", query = "", page = 1, perPage = 20, actorUserId }) => {
  const params = new URLSearchParams();
  params.set("status", status);
  if (query) params.set("q", query);
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  return requestJson({ path: `/api/v1/leaderboard/bans?${params.toString()}`, actorUserId });
};

// Admin: let a banned player register again. Upstream refuses with 409 when
// the ban was already lifted.
const liftBan = async ({ banId, actorUserId }) =>
  requestJson({
    path: `/api/v1/leaderboard/bans/${encodeURIComponent(banId)}/lift`,
    method: "POST",
    actorUserId,
  });

// Admin: players the server check flags for review (status "flagged"), the
// ones an admin already cleared ("cleared"), or every registration ("all").
// `server` narrows any of them to players with a match on that server.
const listServerChecks = async ({ status = "flagged", query = "", server = "", sort = "default", page = 1, perPage = 20, actorUserId }) => {
  const params = new URLSearchParams();
  params.set("status", status);
  if (query) params.set("q", query);
  if (server) params.set("server", server);
  if (sort && sort !== "default") params.set("sort", sort);
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  return requestJson({ path: `/api/v1/leaderboard/server-checks?${params.toString()}`, actorUserId });
};

// Admin: keep a flagged player. Upstream refuses with 409 when they are not flagged.
const clearServerCheck = async ({ puuid, actorUserId }) =>
  requestJson({
    path: `/api/v1/leaderboard/server-checks/${encodeURIComponent(puuid)}/clear`,
    method: "POST",
    actorUserId,
  });

// Admin: undo a clearance. Upstream refuses with 409 when there is none.
const reopenServerCheck = async ({ puuid, actorUserId }) =>
  requestJson({
    path: `/api/v1/leaderboard/server-checks/${encodeURIComponent(puuid)}/clear`,
    method: "DELETE",
    actorUserId,
  });

module.exports = {
  listServerChecks,
  clearServerCheck,
  reopenServerCheck,
  listRegistrations,
  removeRegistration,
  listRemovals,
  restoreRemoval,
  banRegistration,
  banRemoval,
  listBans,
  liftBan,
  repointRegistration,
  getLeaderboard,
  searchLeaderboard,
  checkPuuid,
  checkDiscord,
  previewRegistration,
  submitRegistration,
};
