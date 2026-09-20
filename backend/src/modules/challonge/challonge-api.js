const crypto = require("crypto");
const { env } = require("../../config/env");
const cache = require("../../lib/cache");
const { normalizeText } = require("../../lib/validation");

const rateLimitCacheKey = () => {
  const clientHash = crypto
    .createHash("sha256")
    .update(env.CHALLONGE_CLIENT_ID || "unconfigured")
    .digest("hex")
    .slice(0, 16);
  return `challonge:v2.1:rate-limit:${clientHash}`;
};
let accessTokenState = null;
let accessTokenRequest = null;

class ChallongeRequestError extends Error {
  constructor(message, { code = "challonge_unavailable", status = 502, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = "ChallongeRequestError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const sanitizeErrorMessage = (error) => {
  if (error instanceof ChallongeRequestError) return error.message.slice(0, 500);
  if (error?.name === "AbortError") return "Challonge did not respond before the request timeout.";
  return "Challonge could not be reached. The previous successful data remains available.";
};

const extractChallongeIdentifier = (value) => {
  const input = normalizeText(value);
  if (!input) return null;
  if (/^[a-zA-Z0-9_-]{1,160}$/.test(input)) return input;
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (host !== "challonge.com" && !host.endsWith(".challonge.com"))) return null;
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\/module$/, "");
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(path)) return null;
    return host === "challonge.com" ? path : `${host.split(".")[0]}-${path}`;
  } catch {
    return null;
  }
};

const normalizeChallongePublicUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    if (host !== "challonge.com" && !host.endsWith(".challonge.com")) return null;
    url.protocol = "https:";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/module\/?$/i, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const unwrap = (value, key) => value?.[key] || value;

const parseRetryAfter = (value) => {
  const seconds = Number.parseInt(String(value || ""), 10);
  if (Number.isInteger(seconds) && seconds > 0) return Math.min(seconds, 86400);
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return null;
  return Math.min(Math.max(Math.ceil((date.getTime() - Date.now()) / 1000), 1), 86400);
};

const assertChallongeConfigured = () => {
  if (!env.CHALLONGE_ENABLED || !env.CHALLONGE_CLIENT_ID || !env.CHALLONGE_CLIENT_SECRET) {
    throw new ChallongeRequestError("Challonge synchronization is not configured.", {
      code: "challonge_disabled",
      status: 503,
    });
  }
};

const getRateLimit = async () => {
  const rateLimit = await cache.get(rateLimitCacheKey());
  if (rateLimit?.until && new Date(rateLimit.until).getTime() > Date.now()) {
    throw new ChallongeRequestError("Challonge rate-limited synchronization. A later retry has been scheduled.", {
      code: "challonge_rate_limited",
      status: 429,
      retryAfterSeconds: Math.max(Math.ceil((new Date(rateLimit.until).getTime() - Date.now()) / 1000), 1),
    });
  }
};

const rememberRateLimit = async (response) => {
  const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
  const cooldownSeconds = retryAfterSeconds || Math.max(env.CHALLONGE_DEFAULT_SYNC_MINUTES * 60, 60);
  await cache.set(
    rateLimitCacheKey(),
    { until: new Date(Date.now() + cooldownSeconds * 1000).toISOString() },
    cooldownSeconds
  );
  return retryAfterSeconds;
};

const fetchWithTimeout = async (url, options) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.CHALLONGE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ChallongeRequestError("Challonge did not respond before the request timeout.", {
        code: "challonge_timeout",
        status: 504,
      });
    }
    throw new ChallongeRequestError("Challonge could not be reached.", {
      code: "challonge_network_error",
      status: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const parseJsonResponse = async (response) => {
  try {
    return await response.json();
  } catch {
    throw new ChallongeRequestError("Challonge returned an invalid response.", {
      code: "challonge_invalid_response",
      status: 502,
    });
  }
};

const requestChallongeAccessToken = async ({ forceRefresh = false } = {}) => {
  assertChallongeConfigured();
  await getRateLimit();
  const fingerprint = `${env.CHALLONGE_CLIENT_ID}:${env.CHALLONGE_TOKEN_URL}:${env.CHALLONGE_OAUTH_SCOPE}`;
  if (
    !forceRefresh &&
    accessTokenState?.fingerprint === fingerprint &&
    accessTokenState.refreshAt > Date.now()
  ) {
    return accessTokenState.token;
  }
  if (accessTokenRequest?.fingerprint === fingerprint) {
    return accessTokenRequest.promise;
  }

  const promise = (async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.CHALLONGE_CLIENT_ID,
      client_secret: env.CHALLONGE_CLIENT_SECRET,
    });
    if (env.CHALLONGE_OAUTH_SCOPE) body.set("scope", env.CHALLONGE_OAUTH_SCOPE);
    const response = await fetchWithTimeout(env.CHALLONGE_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!response.ok) {
      const retryAfterSeconds = response.status === 429
        ? await rememberRateLimit(response)
        : parseRetryAfter(response.headers.get("retry-after"));
      throw new ChallongeRequestError(
        response.status === 429
          ? "Challonge rate-limited synchronization. A later retry has been scheduled."
          : "Challonge rejected the server application credentials.",
        {
          code: response.status === 429 ? "challonge_rate_limited" : "challonge_auth_failed",
          status: response.status,
          retryAfterSeconds,
        }
      );
    }
    const payload = await parseJsonResponse(response);
    const token = typeof payload?.access_token === "string" ? payload.access_token.trim() : "";
    if (!token) {
      throw new ChallongeRequestError("Challonge returned an invalid access token response.", {
        code: "challonge_invalid_response",
        status: 502,
      });
    }
    const expiresIn = Number(payload.expires_in);
    const lifetimeSeconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;
    const refreshMarginSeconds = Math.min(60, Math.max(Math.floor(lifetimeSeconds * 0.1), 1));
    accessTokenState = {
      token,
      fingerprint,
      refreshAt: Date.now() + Math.max(lifetimeSeconds - refreshMarginSeconds, 1) * 1000,
    };
    return token;
  })();
  accessTokenRequest = { fingerprint, promise };
  try {
    return await promise;
  } finally {
    if (accessTokenRequest?.promise === promise) accessTokenRequest = null;
  }
};

const buildChallongeApiUrl = (path) => {
  const base = new URL(`${env.CHALLONGE_BASE_URL}/`);
  const requestUrl = new URL(String(path).replace(/^\/+/, ""), base);
  if (requestUrl.origin !== base.origin || !requestUrl.pathname.startsWith(base.pathname)) {
    throw new ChallongeRequestError("Challonge request path was invalid.", {
      code: "challonge_invalid_request",
      status: 500,
    });
  }
  return requestUrl;
};

const requestChallongeJson = async (
  path,
  { method = "GET", body = undefined, retryAuthentication = true } = {}
) => {
  assertChallongeConfigured();
  await getRateLimit();
  const token = await requestChallongeAccessToken();
  const response = await fetchWithTimeout(buildChallongeApiUrl(path), {
    method,
    headers: {
      Accept: "application/json",
      "Authorization-Type": "v2",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.api+json",
    },
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  if (response.status === 401 && retryAuthentication) {
    accessTokenState = null;
    await requestChallongeAccessToken({ forceRefresh: true });
    return requestChallongeJson(path, { method, body, retryAuthentication: false });
  }
  if (!response.ok) {
    const retryAfterSeconds = response.status === 429
      ? await rememberRateLimit(response)
      : parseRetryAfter(response.headers.get("retry-after"));
    const code = response.status === 401
      ? "challonge_auth_failed"
      : response.status === 404
        ? "challonge_not_found"
        : response.status === 429
          ? "challonge_rate_limited"
          : "challonge_upstream_error";
    throw new ChallongeRequestError(
      response.status === 429
        ? "Challonge rate-limited synchronization. A later retry has been scheduled."
        : "Challonge returned an error while synchronizing this tournament.",
      { code, status: response.status, retryAfterSeconds }
    );
  }
  if (response.status === 204) return null;
  return parseJsonResponse(response);
};

const jsonApiResource = (value, legacyKey) => {
  const resource = value?.data && !Array.isArray(value.data) ? value.data : value;
  if (resource?.attributes) {
    return {
      id: resource.id,
      ...resource.attributes,
      relationships: resource.relationships || resource.attributes.relationships,
    };
  }
  return unwrap(resource, legacyKey) || {};
};

const jsonApiCollection = (value, legacyKey) => {
  const source = Array.isArray(value?.data) ? value.data : Array.isArray(value) ? value : [];
  return source
    .map((entry) => jsonApiResource(entry, legacyKey))
    .filter(Boolean);
};

const relationshipId = (match, name, legacyName) => {
  const value = match.relationships?.[name]?.data?.id ?? match[legacyName];
  return value === null || value === undefined ? null : String(value);
};

const pointsParticipantId = (match, index) => {
  const value = Array.isArray(match.points_by_participant)
    ? match.points_by_participant[index]?.participant_id
    : null;
  return value === null || value === undefined ? null : String(value);
};

const scoresCsvFromMatch = (match) => {
  if (Array.isArray(match.score_in_sets) && match.score_in_sets.length) {
    return match.score_in_sets
      .filter((set) => Array.isArray(set) && set.length >= 2)
      .map((set) => `${set[0]}-${set[1]}`)
      .join(",")
      .slice(0, 500) || null;
  }
  const score = match.scores_csv ?? match.scores;
  return score === null || score === undefined ? null : String(score).slice(0, 500);
};

const normalizeSnapshot = ({ tournamentPayload, participantPayload, matchPayload }) => {
  const tournament = jsonApiResource(tournamentPayload, "tournament");
  const participantSource = participantPayload === undefined && Array.isArray(tournament.participants)
    ? tournament.participants
    : jsonApiCollection(participantPayload, "participant");
  const matchSource = matchPayload === undefined && Array.isArray(tournament.matches)
    ? tournament.matches
    : jsonApiCollection(matchPayload, "match");
  const participants = participantSource
    .map((entry) => jsonApiResource(entry, "participant"))
    .map((participant) => ({
      id: String(participant.id),
      name: String(participant.name || participant.display_name || "Participant").slice(0, 160),
      seed: Number.isInteger(participant.seed) ? participant.seed : null,
      active: participant.states?.active ?? participant.active !== false,
      finalRank: Number.isInteger(participant.final_rank) ? participant.final_rank : null,
      checkedInAt: participant.timestamps?.checked_in_at || participant.checked_in_at || null,
    }));
  const matches = matchSource
    .map((entry) => jsonApiResource(entry, "match"))
    .map((match) => ({
      id: String(match.id),
      identifier: match.identifier ? String(match.identifier) : null,
      round: Number.isInteger(match.round) ? match.round : null,
      state: String(match.state || "pending").trim().toLowerCase(),
      player1Id: relationshipId(match, "player1", "player1_id") || pointsParticipantId(match, 0),
      player2Id: relationshipId(match, "player2", "player2_id") || pointsParticipantId(match, 1),
      winnerId: match.winner_id === null || match.winner_id === undefined ? null : String(match.winner_id),
      loserId: match.loser_id === null || match.loser_id === undefined ? null : String(match.loser_id),
      scoresCsv: scoresCsvFromMatch(match),
      scheduledAt: match.scheduled_time || match.scheduled_at || null,
      startedAt: match.timestamps?.started_at || match.started_at || match.underway_at || null,
      underwayAt: match.timestamps?.underway_at || match.underway_at || null,
      location: match.location ? String(match.location).slice(0, 120) : null,
      updatedAt: match.timestamps?.updated_at || match.updated_at || null,
    }))
    .sort((left, right) => (left.round ?? 0) - (right.round ?? 0) || left.id.localeCompare(right.id));
  return {
    tournament: {
      id: tournament.id === undefined ? null : String(tournament.id),
      name: String(tournament.name || "Challonge Tournament").slice(0, 200),
      state: String(tournament.state || tournament.states?.current || (tournament.completed_at ? "complete" : "pending")).trim().toLowerCase(),
      tournamentType: String(tournament.tournament_type || "unknown"),
      teams: tournament.teams === true,
      startedAt: tournament.timestamps?.started_at || tournament.started_at || null,
      completedAt: tournament.timestamps?.completed_at || tournament.completed_at || null,
      updatedAt: tournament.timestamps?.updated_at || tournament.updated_at || null,
      progressMeter: Number.isFinite(Number(tournament.progress_meter))
        ? Math.min(Math.max(Number(tournament.progress_meter), 0), 100)
        : null,
      fullChallongeUrl: normalizeChallongePublicUrl(
        tournament.full_challonge_url ||
          (tournament.url
            ? `https://${tournament.subdomain ? `${tournament.subdomain}.` : ""}challonge.com/${tournament.url}`
            : null)
      ),
    },
    participants,
    matches,
  };
};

const requestChallongeCollection = async (path) => {
  const all = [];
  let page = 1;
  while (page <= 50) {
    const separator = path.includes("?") ? "&" : "?";
    const payload = await requestChallongeJson(`${path}${separator}page=${page}&per_page=100`);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    all.push(...rows);
    if (rows.length < 100) break;
    page += 1;
  }
  return { data: all };
};

const tournamentIdentifierCandidates = (resource) => {
  const tournament = jsonApiResource(resource, "tournament");
  return new Set([
    resource?.id,
    tournament.id,
    tournament.url,
    tournament.identifier,
    tournament.permalink,
    tournament.subdomain && tournament.url ? `${tournament.subdomain}-${tournament.url}` : null,
  ].filter(Boolean).map(String));
};

const resolveApplicationTournamentId = async (identifier) => {
  if (/^\d+$/.test(identifier)) return identifier;
  const payload = await requestChallongeCollection("/application/tournaments.json");
  const match = payload.data.find((resource) => tournamentIdentifierCandidates(resource).has(identifier));
  if (!match?.id) {
    throw new ChallongeRequestError(
      "The tournament was not found among tournaments connected to this Challonge application.",
      { code: "challonge_not_found", status: 404 }
    );
  }
  return String(match.id);
};

const fetchChallongeSnapshot = async (identifier) => {
  const tournamentId = await resolveApplicationTournamentId(identifier);
  const safeIdentifier = encodeURIComponent(tournamentId);
  const tournamentPayload = await requestChallongeJson(`/application/tournaments/${safeIdentifier}.json`);
  const [participantPayload, matchPayload] = await Promise.all([
    requestChallongeCollection(`/application/tournaments/${safeIdentifier}/participants.json`),
    requestChallongeCollection(`/application/tournaments/${safeIdentifier}/matches.json`),
  ]);
  return normalizeSnapshot({ tournamentPayload, participantPayload, matchPayload });
};

module.exports = {
  ChallongeRequestError,
  sanitizeErrorMessage,
  extractChallongeIdentifier,
  normalizeChallongePublicUrl,
  requestChallongeJson,
  normalizeSnapshot,
  resolveApplicationTournamentId,
  fetchChallongeSnapshot,
};
