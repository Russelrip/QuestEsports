const crypto = require("crypto");
const { env } = require("../../config/env");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const cache = require("../../lib/cache");
const { normalizeText } = require("../../lib/validation");
const { publishRealtimeEvent } = require("../realtime/realtime.service");

const SYNC_FREQUENCIES = new Set(["manual", "one_minute", "five_minutes"]);
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
const LOCAL_OPERATIONAL_STATUSES = new Set([
  "check_in_open",
  "veto_starting_soon",
  "veto_in_progress",
  "ready",
  "delayed",
  "paused",
]);

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
      player1Id: relationshipId(match, "player1", "player1_id"),
      player2Id: relationshipId(match, "player2", "player2_id"),
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

const mapChallongeStatus = (match) => {
  if (["complete", "completed", "ended"].includes(match.state)) return "completed";
  if (["underway", "in_progress"].includes(match.state)) return "live";
  if (match.state === "open" && (match.underwayAt || match.startedAt)) return "live";
  if (match.state === "open") return "ready";
  if (match.state === "pending") return match.scheduledAt ? "scheduled" : "not_scheduled";
  return "not_scheduled";
};

const parseScores = (scoresCsv) => {
  if (!scoresCsv) return [null, null];
  const sets = scoresCsv.split(",").map((value) => value.trim()).filter(Boolean);
  if (sets.length === 1) {
    const [left, right] = sets[0].split("-");
    return [left || null, right || null];
  }
  let leftWins = 0;
  let rightWins = 0;
  for (const set of sets) {
    const [left, right] = set.split("-").map(Number);
    if (Number.isFinite(left) && Number.isFinite(right)) {
      if (left > right) leftWins += 1;
      if (right > left) rightWins += 1;
    }
  }
  return [String(leftWins), String(rightWins)];
};

const getNextSyncAt = (frequency, from = new Date()) => {
  if (frequency === "manual") return null;
  const minutes = frequency === "one_minute" ? 1 : 5;
  return new Date(from.getTime() + minutes * 60_000);
};

const syncSnapshotToMatches = async ({ integration, snapshot }) => {
  const participantById = new Map(snapshot.participants.map((participant) => [participant.id, participant]));
  const existingMatches = await prisma.match.findMany({
    where: { tournamentId: integration.tournamentId, source: "challonge" },
    select: { id: true, externalId: true, status: true },
  });
  const existingByExternalId = new Map(existingMatches.map((match) => [match.externalId, match]));

  await prisma.$transaction(async (tx) => {
    for (const participant of snapshot.participants) {
      await tx.challongeParticipantLink.upsert({
        where: {
          integrationId_externalParticipantId: {
            integrationId: integration.id,
            externalParticipantId: participant.id,
          },
        },
        create: {
          id: crypto.randomUUID(),
          integrationId: integration.id,
          externalParticipantId: participant.id,
          displayName: participant.name,
          seed: participant.seed,
        },
        update: { displayName: participant.name, seed: participant.seed },
      });
    }
    const links = await tx.challongeParticipantLink.findMany({
      where: { integrationId: integration.id },
    });
    const linkByExternalId = new Map(links.map((link) => [link.externalParticipantId, link]));

    for (const externalMatch of snapshot.matches) {
      const upstreamStatus = mapChallongeStatus(externalMatch);
      const current = existingByExternalId.get(externalMatch.id);
      const preserveOperationalStatus = current && LOCAL_OPERATIONAL_STATUSES.has(current.status) && upstreamStatus !== "completed";
      const winnerSlot = externalMatch.winnerId === externalMatch.player1Id
        ? 1
        : externalMatch.winnerId === externalMatch.player2Id
          ? 2
          : null;
      const [score1, score2] = parseScores(externalMatch.scoresCsv);
      const match = await tx.match.upsert({
        where: {
          tournamentId_source_externalId: {
            tournamentId: integration.tournamentId,
            source: "challonge",
            externalId: externalMatch.id,
          },
        },
        create: {
          id: crypto.randomUUID(),
          tournamentId: integration.tournamentId,
          source: "challonge",
          externalId: externalMatch.id,
          identifier: externalMatch.identifier,
          roundNumber: externalMatch.round,
          status: upstreamStatus,
          scheduledAt: externalMatch.scheduledAt ? new Date(externalMatch.scheduledAt) : null,
          scoreData: { scoresCsv: externalMatch.scoresCsv },
          winnerSlot,
          completedAt: upstreamStatus === "completed" ? new Date(externalMatch.updatedAt || Date.now()) : null,
          externalUpdatedAt: externalMatch.updatedAt ? new Date(externalMatch.updatedAt) : null,
        },
        update: {
          identifier: externalMatch.identifier,
          roundNumber: externalMatch.round,
          status: preserveOperationalStatus ? current.status : upstreamStatus,
          scheduledAt: externalMatch.scheduledAt ? new Date(externalMatch.scheduledAt) : null,
          scoreData: { scoresCsv: externalMatch.scoresCsv },
          winnerSlot,
          completedAt: upstreamStatus === "completed" ? new Date(externalMatch.updatedAt || Date.now()) : null,
          externalUpdatedAt: externalMatch.updatedAt ? new Date(externalMatch.updatedAt) : null,
        },
      });

      for (const [index, externalParticipantId] of [externalMatch.player1Id, externalMatch.player2Id].entries()) {
        const slot = index + 1;
        const participant = externalParticipantId ? participantById.get(externalParticipantId) : null;
        const link = externalParticipantId ? linkByExternalId.get(externalParticipantId) : null;
        const score = slot === 1 ? score1 : score2;
        await tx.matchParticipant.upsert({
          where: { matchId_slot: { matchId: match.id, slot } },
          create: {
            id: crypto.randomUUID(),
            matchId: match.id,
            slot,
            registrationId: link?.isConfirmed ? link.registrationId : null,
            externalParticipantId,
            displayName: participant?.name || "TBD",
            seed: participant?.seed ?? null,
            score,
            result: winnerSlot === slot ? "win" : winnerSlot ? "loss" : null,
          },
          update: {
            registrationId: link?.isConfirmed ? link.registrationId : null,
            externalParticipantId,
            displayName: participant?.name || "TBD",
            seed: participant?.seed ?? null,
            score,
            result: winnerSlot === slot ? "win" : winnerSlot ? "loss" : null,
          },
        });
      }
    }
    await tx.match.deleteMany({
      where: {
        tournamentId: integration.tournamentId,
        source: "challonge",
        ...(snapshot.matches.length
          ? { externalId: { notIn: snapshot.matches.map((match) => match.id) } }
          : {}),
      },
    });
  });
};

const claimSyncLease = async (integrationId) => {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + env.CHALLONGE_SYNC_LEASE_SECONDS * 1000);
  const result = await prisma.challongeIntegration.updateMany({
    where: {
      id: integrationId,
      OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: now } }],
    },
    data: { syncLeaseUntil: leaseUntil, lastAttemptAt: now },
  });
  return result.count === 1;
};

const recordSkippedAttempt = async ({ integration, trigger, requestId, reason }) => {
  const now = new Date();
  await prisma.$transaction([
    prisma.challongeIntegration.update({
      where: { id: integration.id },
      data: { lastAttemptAt: now },
    }),
    prisma.challongeSyncLog.create({
      data: {
        id: crypto.randomUUID(),
        integrationId: integration.id,
        identifier: integration.identifier,
        status: "skipped",
        trigger,
        requestId,
        errorCode: reason,
        startedAt: now,
        completedAt: now,
        durationMs: 0,
      },
    }),
  ]);
  return { skipped: true, reason };
};

const recordChallongeSkippedAttempt = async ({ integrationId, trigger = "scheduled", requestId = null, reason }) => {
  const integration = await prisma.challongeIntegration.findUnique({ where: { id: integrationId } });
  if (!integration) return { skipped: true, reason };
  return recordSkippedAttempt({ integration, trigger, requestId, reason });
};

const syncChallongeIntegration = async ({ integrationId, trigger = "manual", requestId = null }) => {
  const integration = await prisma.challongeIntegration.findUnique({
    where: { id: integrationId },
    include: { tournament: { select: { id: true, slug: true, status: true } } },
  });
  if (!integration) throw new HttpError(404, "Challonge integration not found.");
  if (trigger === "scheduled" && (!integration.enabled || !integration.automaticSyncEnabled)) {
    return recordSkippedAttempt({ integration, trigger, requestId, reason: "automatic_sync_disabled" });
  }
  if (trigger === "scheduled" && integration.tournament.status === "completed") {
    await prisma.challongeIntegration.update({ where: { id: integration.id }, data: { nextSyncAt: null, syncLeaseUntil: null } });
    return recordSkippedAttempt({ integration, trigger, requestId, reason: "tournament_completed" });
  }
  if (!(await claimSyncLease(integration.id))) {
    return recordSkippedAttempt({ integration, trigger, requestId, reason: "already_running" });
  }

  const log = await prisma.challongeSyncLog.create({
    data: {
      id: crypto.randomUUID(),
      integrationId: integration.id,
      identifier: integration.identifier,
      status: "running",
      trigger,
      requestId,
    },
  });
  try {
    const snapshot = await fetchChallongeSnapshot(integration.identifier);
    await syncSnapshotToMatches({ integration, snapshot });
    const serialized = JSON.stringify(snapshot);
    const snapshotHash = crypto.createHash("sha256").update(serialized).digest("hex");
    const completed = ["complete", "completed", "ended"].includes(snapshot.tournament.state);
    const now = new Date();
    const shouldSchedule = integration.enabled && integration.automaticSyncEnabled &&
      integration.tournament.status !== "completed" && !completed;
    await prisma.$transaction([
      prisma.challongeIntegration.update({
        where: { id: integration.id },
        data: {
          snapshotData: snapshot,
          snapshotHash,
          snapshotUpdatedAt: now,
          lastSuccessAt: now,
          lastErrorCode: null,
          lastErrorMessage: null,
          syncLeaseUntil: null,
          nextSyncAt: shouldSchedule ? getNextSyncAt(integration.syncFrequency, now) : null,
        },
      }),
      prisma.challongeSyncLog.update({
        where: { id: log.id },
        data: {
          status: "succeeded",
          completedAt: now,
          tournamentState: snapshot.tournament.state,
          participantCount: snapshot.participants.length,
          matchCount: snapshot.matches.length,
          durationMs: Math.max(0, now.getTime() - log.startedAt.getTime()),
        },
      }),
      ...(snapshot.tournament.fullChallongeUrl
        ? [prisma.tournament.update({
            where: { id: integration.tournamentId },
            data: { bracketLink: snapshot.tournament.fullChallongeUrl },
          })]
        : []),
    ]);
    publishRealtimeEvent("brackets", { tournamentId: integration.tournamentId, syncedAt: now.toISOString() });
    publishRealtimeEvent("matches", { tournamentId: integration.tournamentId, syncedAt: now.toISOString() });
    await cache.invalidateTags(["foundation"]);
    return { skipped: false, snapshot, syncedAt: now };
  } catch (error) {
    const now = new Date();
    const code = error.code || "challonge_unavailable";
    const message = sanitizeErrorMessage(error);
    const retrySeconds = error.retryAfterSeconds || Math.max(env.CHALLONGE_DEFAULT_SYNC_MINUTES * 60, 60);
    const shouldRetry = integration.enabled && integration.automaticSyncEnabled &&
      integration.tournament.status !== "completed";
    await prisma.$transaction([
      prisma.challongeIntegration.update({
        where: { id: integration.id },
        data: {
          lastErrorCode: code,
          lastErrorMessage: message,
          syncLeaseUntil: null,
          nextSyncAt: shouldRetry ? new Date(now.getTime() + retrySeconds * 1000) : null,
        },
      }),
      prisma.challongeSyncLog.update({
        where: { id: log.id },
        data: {
          status: "failed",
          completedAt: now,
          httpStatus: Number.isInteger(error.status) ? error.status : null,
          errorCode: code,
          errorMessage: message,
          durationMs: Math.max(0, now.getTime() - log.startedAt.getTime()),
        },
      }),
    ]);
    logger.warn("Challonge synchronization failed", {
      integrationId: integration.id,
      tournamentId: integration.tournamentId,
      code,
      status: error.status || null,
    });
    if (trigger === "scheduled") {
      return {
        skipped: false,
        failed: true,
        errorCode: code,
        retryAt: shouldRetry ? new Date(now.getTime() + retrySeconds * 1000) : null,
      };
    }
    const responseStatus = [400, 401, 404, 429, 502, 503, 504].includes(error.status) ? error.status : 502;
    const httpError = new HttpError(responseStatus, message);
    httpError.code = code;
    throw httpError;
  }
};

const mapIntegration = (integration) => integration ? ({
  id: integration.id,
  tournamentId: integration.tournamentId,
  identifier: integration.identifier,
  enabled: integration.enabled,
  automaticSyncEnabled: integration.automaticSyncEnabled,
  syncFrequency: integration.syncFrequency,
  snapshotUpdatedAt: integration.snapshotUpdatedAt,
  nextSyncAt: integration.nextSyncAt,
  lastAttemptAt: integration.lastAttemptAt,
  lastSuccessAt: integration.lastSuccessAt,
  lastError: integration.lastErrorCode
    ? { code: integration.lastErrorCode, message: integration.lastErrorMessage }
    : null,
  editor: integration.snapshotData && typeof integration.snapshotData === "object"
    ? {
        tournament: integration.snapshotData.tournament || null,
        participants: Array.isArray(integration.snapshotData.participants)
          ? integration.snapshotData.participants
          : [],
        matches: Array.isArray(integration.snapshotData.matches)
          ? integration.snapshotData.matches
          : [],
      }
    : null,
  participants: (integration.participantLinks || []).map((link) => ({
    id: link.id,
    externalParticipantId: link.externalParticipantId,
    displayName: link.displayName,
    seed: link.seed,
    registrationId: link.registrationId,
    isConfirmed: link.isConfirmed,
  })),
}) : null;

const getAdminIntegration = async (tournamentId) => {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true } });
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const integration = await prisma.challongeIntegration.findUnique({
    where: { tournamentId },
    include: { participantLinks: { orderBy: [{ seed: "asc" }, { displayName: "asc" }] } },
  });
  return mapIntegration(integration);
};

const getWritableIntegration = async (tournamentId) => {
  const integration = await prisma.challongeIntegration.findUnique({
    where: { tournamentId },
    select: {
      id: true,
      tournamentId: true,
      identifier: true,
      enabled: true,
      snapshotData: true,
    },
  });
  if (!integration || !integration.enabled) {
    throw new HttpError(409, "Enable the Challonge connection before editing the tournament.");
  }
  const snapshotTournamentId = integration.snapshotData?.tournament?.id;
  const externalTournamentId = snapshotTournamentId
    ? String(snapshotTournamentId)
    : await resolveApplicationTournamentId(integration.identifier);
  return { integration, externalTournamentId };
};

const updateStoredSnapshot = async (integration, mutate) => {
  const current = integration.snapshotData && typeof integration.snapshotData === "object"
    ? structuredClone(integration.snapshotData)
    : { tournament: null, participants: [], matches: [] };
  current.participants = Array.isArray(current.participants) ? current.participants : [];
  current.matches = Array.isArray(current.matches) ? current.matches : [];
  const next = mutate(current) || current;
  await prisma.challongeIntegration.update({
    where: { id: integration.id },
    data: {
      snapshotData: next,
      snapshotHash: crypto.createHash("sha256").update(JSON.stringify(next)).digest("hex"),
      snapshotUpdatedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });
  return next;
};

const normalizeSeed = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const seed = Number(value);
  if (!Number.isInteger(seed) || seed < 1 || seed > 10000) {
    throw new HttpError(400, "Seed must be an integer from 1 to 10000.");
  }
  return seed;
};

const normalizeParticipantName = (value) => {
  const name = normalizeText(value);
  if (!name || name.length > 160) {
    throw new HttpError(400, "Participant name must be between 1 and 160 characters.");
  }
  return name;
};

const normalizedParticipantFromPayload = (payload) =>
  normalizeSnapshot({ participantPayload: { data: [payload?.data] } }).participants[0] || null;

const normalizedMatchFromPayload = (payload) =>
  normalizeSnapshot({ matchPayload: { data: [payload?.data] } }).matches[0] || null;

const createChallongeParticipant = async ({ tournamentId, body }) => {
  const { integration, externalTournamentId } = await getWritableIntegration(tournamentId);
  const attributes = { name: normalizeParticipantName(body.name) };
  const seed = normalizeSeed(body.seed);
  if (seed !== null) attributes.seed = seed;
  const payload = await requestChallongeJson(
    `/application/tournaments/${encodeURIComponent(externalTournamentId)}/participants.json`,
    {
      method: "POST",
      body: { data: { type: "participant", attributes } },
    }
  );
  const participant = normalizedParticipantFromPayload(payload);
  if (!participant) throw new ChallongeRequestError("Challonge returned an invalid participant response.", { code: "challonge_invalid_response" });
  await updateStoredSnapshot(integration, (snapshot) => {
    snapshot.participants = [
      ...snapshot.participants.filter((entry) => entry.id !== participant.id),
      participant,
    ];
    return snapshot;
  });
  return participant;
};

const updateChallongeParticipant = async ({ tournamentId, participantId, body }) => {
  const { integration, externalTournamentId } = await getWritableIntegration(tournamentId);
  const externalParticipantId = String(participantId || "");
  if (!/^\d+$/.test(externalParticipantId)) throw new HttpError(400, "Invalid Challonge participant ID.");
  const attributes = { name: normalizeParticipantName(body.name) };
  const seed = normalizeSeed(body.seed);
  if (seed !== null) attributes.seed = seed;
  const payload = await requestChallongeJson(
    `/application/tournaments/${encodeURIComponent(externalTournamentId)}/participants/${encodeURIComponent(externalParticipantId)}.json`,
    {
      method: "PUT",
      body: { data: { type: "participant", attributes } },
    }
  );
  const participant = normalizedParticipantFromPayload(payload);
  if (!participant) throw new ChallongeRequestError("Challonge returned an invalid participant response.", { code: "challonge_invalid_response" });
  await updateStoredSnapshot(integration, (snapshot) => {
    snapshot.participants = snapshot.participants.map((entry) =>
      entry.id === externalParticipantId ? participant : entry
    );
    return snapshot;
  });
  return participant;
};

const deleteChallongeParticipant = async ({ tournamentId, participantId }) => {
  const { integration, externalTournamentId } = await getWritableIntegration(tournamentId);
  const externalParticipantId = String(participantId || "");
  if (!/^\d+$/.test(externalParticipantId)) throw new HttpError(400, "Invalid Challonge participant ID.");
  await requestChallongeJson(
    `/application/tournaments/${encodeURIComponent(externalTournamentId)}/participants/${encodeURIComponent(externalParticipantId)}.json`,
    { method: "DELETE" }
  );
  await updateStoredSnapshot(integration, (snapshot) => {
    snapshot.participants = snapshot.participants.filter((entry) => entry.id !== externalParticipantId);
    return snapshot;
  });
  return { id: externalParticipantId, deleted: true };
};

const TOURNAMENT_STATE_TRANSITIONS = new Map([
  ["start", "underway"],
  ["finalize", "complete"],
  ["reset", "pending"],
  ["start_group_stage", "group_stages_underway"],
  ["finalize_group_stage", "group_stages_finalized"],
  ["reset_group_stage", "pending"],
]);

const changeChallongeTournamentState = async ({ tournamentId, body }) => {
  const { integration, externalTournamentId } = await getWritableIntegration(tournamentId);
  const transition = normalizeText(body.state).toLowerCase();
  if (!TOURNAMENT_STATE_TRANSITIONS.has(transition)) {
    throw new HttpError(400, "Choose a supported Challonge tournament state action.");
  }
  await requestChallongeJson(
    `/application/tournaments/${encodeURIComponent(externalTournamentId)}/change_state.json`,
    {
      method: "PUT",
      body: { data: { type: "TournamentState", attributes: { state: transition } } },
    }
  );
  const state = TOURNAMENT_STATE_TRANSITIONS.get(transition);
  await updateStoredSnapshot(integration, (snapshot) => {
    snapshot.tournament = { ...(snapshot.tournament || {}), id: externalTournamentId, state };
    return snapshot;
  });
  return { tournamentId: externalTournamentId, transition, state };
};

const normalizeScoreSet = (value, label) => {
  const score = normalizeText(value).replace(/\s+/g, "");
  if (!/^-?\d+(,-?\d+)*$/.test(score) || score.length > 200) {
    throw new HttpError(400, `${label} must contain comma-separated integer scores.`);
  }
  return score;
};

const updateChallongeMatchResult = async ({ tournamentId, matchId, body }) => {
  const { integration, externalTournamentId } = await getWritableIntegration(tournamentId);
  const externalMatchId = String(matchId || "");
  if (!/^\d+$/.test(externalMatchId)) throw new HttpError(400, "Invalid Challonge match ID.");
  const existing = integration.snapshotData?.matches?.find((match) => match.id === externalMatchId);
  if (!existing) throw new HttpError(409, "Load current Challonge data before editing this match.");
  const participantIds = [existing.player1Id, existing.player2Id].filter(Boolean).map(String);
  if (participantIds.length !== 2) throw new HttpError(409, "This match does not yet have two assigned participants.");
  const tie = body.tie === true || String(body.tie).toLowerCase() === "true";
  const winnerId = tie ? null : String(body.winnerId || "");
  if (!tie && !participantIds.includes(winnerId)) throw new HttpError(400, "Choose the match winner.");
  const scores = [
    normalizeScoreSet(body.player1Score, "Player 1 score"),
    normalizeScoreSet(body.player2Score, "Player 2 score"),
  ];
  const payload = await requestChallongeJson(
    `/application/tournaments/${encodeURIComponent(externalTournamentId)}/matches/${encodeURIComponent(externalMatchId)}.json`,
    {
      method: "PUT",
      body: {
        data: {
          type: "match",
          attributes: {
            match: participantIds.map((participantId, index) => ({
              participant_id: participantId,
              score_set: scores[index],
              advancing: !tie && participantId === winnerId,
            })),
            tie,
          },
        },
      },
    }
  );
  const match = normalizedMatchFromPayload(payload);
  if (!match) throw new ChallongeRequestError("Challonge returned an invalid match response.", { code: "challonge_invalid_response" });
  await updateStoredSnapshot(integration, (snapshot) => {
    snapshot.matches = snapshot.matches.map((entry) => entry.id === externalMatchId ? match : entry);
    return snapshot;
  });
  return match;
};

const saveAdminIntegration = async ({ tournamentId, body }) => {
  const identifier = extractChallongeIdentifier(body.identifier || body.url);
  const syncFrequency = normalizeText(body.syncFrequency).toLowerCase() || "five_minutes";
  if (!identifier) throw new HttpError(400, "Enter a valid Challonge identifier or HTTPS tournament URL.");
  if (!SYNC_FREQUENCIES.has(syncFrequency)) throw new HttpError(400, "Invalid Challonge synchronization frequency.");
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, status: true },
  });
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const existing = await prisma.challongeIntegration.findUnique({ where: { tournamentId } });
  const enabled = body.enabled === undefined
    ? existing?.enabled ?? true
    : body.enabled === true || String(body.enabled).toLowerCase() === "true";
  const automaticSyncEnabled = env.CHALLONGE_AUTOMATIC_SYNC_ENABLED && syncFrequency !== "manual" && (
    body.automaticSyncEnabled === true || String(body.automaticSyncEnabled).toLowerCase() === "true"
  );
  const identifierChanged = Boolean(existing && existing.identifier !== identifier);
  const normalizedUrl = normalizeChallongePublicUrl(body.url || body.identifier);
  const integration = await prisma.$transaction(async (tx) => {
    if (identifierChanged) {
      await tx.match.deleteMany({ where: { tournamentId, source: "challonge" } });
      await tx.challongeParticipantLink.deleteMany({ where: { integrationId: existing.id } });
    }
    if (normalizedUrl) {
      await tx.tournament.update({ where: { id: tournamentId }, data: { bracketLink: normalizedUrl } });
    }
    return tx.challongeIntegration.upsert({
      where: { tournamentId },
      create: {
        id: crypto.randomUUID(),
        tournamentId,
        identifier,
        enabled,
        automaticSyncEnabled,
        syncFrequency: syncFrequency === "manual" ? "five_minutes" : syncFrequency,
        nextSyncAt: enabled && automaticSyncEnabled && tournament.status !== "completed" ? new Date() : null,
      },
      update: {
        identifier,
        enabled,
        automaticSyncEnabled,
        syncFrequency: syncFrequency === "manual" ? "five_minutes" : syncFrequency,
        nextSyncAt: enabled && automaticSyncEnabled && tournament.status !== "completed" ? new Date() : null,
        ...(identifierChanged ? {
          snapshotData: null,
          snapshotHash: null,
          snapshotUpdatedAt: null,
          lastSuccessAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
        } : {}),
      },
      include: { participantLinks: true },
    });
  });
  return mapIntegration(integration);
};

const listSyncLogs = async (tournamentId) => {
  const integration = await prisma.challongeIntegration.findUnique({ where: { tournamentId }, select: { id: true } });
  if (!integration) return [];
  return prisma.challongeSyncLog.findMany({
    where: { integrationId: integration.id },
    orderBy: { startedAt: "desc" },
    take: 50,
  });
};

const updateParticipantMapping = async ({ tournamentId, participantId, body }) => {
  const integration = await prisma.challongeIntegration.findUnique({ where: { tournamentId }, select: { id: true } });
  if (!integration) throw new HttpError(404, "Challonge integration not found.");
  const registrationId = normalizeText(body.registrationId) || null;
  if (registrationId) {
    const registration = await prisma.teamRegistration.findFirst({
      where: { id: registrationId, tournamentId },
      select: { id: true },
    });
    if (!registration) throw new HttpError(400, "Choose a registration from this tournament.");
  }
  const link = await prisma.challongeParticipantLink.findFirst({
    where: { id: participantId, integrationId: integration.id },
  });
  if (!link) throw new HttpError(404, "Challonge participant not found.");
  await prisma.challongeParticipantLink.update({
    where: { id: link.id },
    data: { registrationId, isConfirmed: Boolean(registrationId) },
  });
  await prisma.matchParticipant.updateMany({
    where: {
      match: { tournamentId, source: "challonge" },
      externalParticipantId: link.externalParticipantId,
    },
    data: { registrationId },
  });
  return mapIntegration({ ...await prisma.challongeIntegration.findUnique({
    where: { id: integration.id },
    include: { participantLinks: { orderBy: [{ seed: "asc" }, { displayName: "asc" }] } },
  }) });
};

const registrationLogoUrl = (registration) => {
  const filename = registration?.savedTeam?.logoName || registration?.teamLogoName;
  return filename ? `/api/uploads/team-logos/${filename}` : null;
};

const buildPublicSnapshot = (snapshot, participantLinks = []) => {
  const linkByExternalId = new Map(participantLinks.map((link) => [link.externalParticipantId, link]));
  const participants = snapshot.participants.map((participant) => {
    const link = linkByExternalId.get(participant.id);
    return {
      ...participant,
      registrationId: link?.isConfirmed ? link.registrationId : null,
      teamName: link?.isConfirmed ? link.registration?.teamName || participant.name : participant.name,
      logoUrl: link?.isConfirmed ? registrationLogoUrl(link.registration) : null,
    };
  });
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));
  const matches = snapshot.matches.map((match) => {
    const player1 = match.player1Id ? participantById.get(match.player1Id) : null;
    const player2 = match.player2Id ? participantById.get(match.player2Id) : null;
    const winner = match.winnerId ? participantById.get(match.winnerId) : null;
    const [score1, score2] = parseScores(match.scoresCsv);
    const status = mapChallongeStatus(match);
    return {
      id: match.id,
      identifier: match.identifier,
      roundNumber: match.round,
      status,
      scheduledAt: match.scheduledAt,
      startedAt: match.startedAt,
      location: match.location,
      scoresCsv: match.scoresCsv,
      scoreSets: match.scoresCsv ? match.scoresCsv.split(",").map((score) => score.trim()).filter(Boolean) : [],
      participants: [
        { id: player1?.id || null, name: player1?.teamName || "TBD", seed: player1?.seed ?? null, score: score1, result: match.winnerId ? (match.winnerId === player1?.id ? "win" : "loss") : null, logoUrl: player1?.logoUrl || null },
        { id: player2?.id || null, name: player2?.teamName || "TBD", seed: player2?.seed ?? null, score: score2, result: match.winnerId ? (match.winnerId === player2?.id ? "win" : "loss") : null, logoUrl: player2?.logoUrl || null },
      ],
      winner: winner ? { id: winner.id, name: winner.teamName, seed: winner.seed } : null,
      completedResult: status === "completed"
        ? `${player1?.teamName || "TBD"} ${score1 || "-"} - ${score2 || "-"} ${player2?.teamName || "TBD"}`
        : null,
    };
  });
  const completedMatches = matches.filter((match) => match.status === "completed").length;
  const standings = participants
    .filter((participant) => participant.finalRank !== null)
    .sort((left, right) => left.finalRank - right.finalRank || (left.seed ?? 9999) - (right.seed ?? 9999));
  const winner = standings.find((participant) => participant.finalRank === 1) ||
    [...matches].reverse().find((match) => match.winner)?.winner || null;
  const progressPercent = snapshot.tournament.progressMeter ??
    (matches.length ? Math.round((completedMatches / matches.length) * 100) : 0);
  return {
    tournament: {
      id: snapshot.tournament.id,
      name: snapshot.tournament.name,
      status: snapshot.tournament.state,
      tournamentType: snapshot.tournament.tournamentType,
      teams: snapshot.tournament.teams,
      startedAt: snapshot.tournament.startedAt,
      completedAt: snapshot.tournament.completedAt,
      updatedAt: snapshot.tournament.updatedAt,
      progressPercent,
    },
    participants,
    matches,
    progression: {
      completedMatches,
      totalMatches: matches.length,
      progressPercent,
      winner,
      standings,
    },
  };
};

const getPublicBracket = async (slug) => {
  const tournament = await prisma.tournament.findFirst({
    where: { slug: normalizeText(slug).toLowerCase(), isPublished: true },
    include: {
      challongeIntegration: {
        include: {
          participantLinks: {
            include: {
              registration: {
                select: { teamName: true, teamLogoName: true, savedTeam: { select: { logoName: true } } },
              },
            },
          },
        },
      },
      bracket: true,
    },
  });
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const integration = tournament.challongeIntegration;
  if (integration?.enabled) {
    const ageMs = integration.lastSuccessAt ? Date.now() - integration.lastSuccessAt.getTime() : Infinity;
    const staleAfterMs = (integration.syncFrequency === "one_minute" ? 3 : 10) * 60_000;
    const matchingLegacyUrl = extractChallongeIdentifier(tournament.bracketLink) === integration.identifier
      ? normalizeChallongePublicUrl(tournament.bracketLink)
      : null;
    if (!integration.snapshotData && tournament.bracket?.status === "published") {
      return {
        source: "native",
        requestedSource: "challonge",
        status: "fresh",
        data: tournament.bracket.bracketData,
        syncedAt: tournament.bracket.lastUpdatedAt,
        error: integration.lastErrorCode
          ? { code: integration.lastErrorCode, message: integration.lastErrorMessage }
          : null,
        externalUrl: matchingLegacyUrl,
      };
    }
    const snapshot = integration.snapshotData;
    return {
      source: "challonge",
      status: snapshot ? (integration.lastErrorCode || ageMs > staleAfterMs ? "stale" : "fresh") : "unavailable",
      data: snapshot ? buildPublicSnapshot(snapshot, integration.participantLinks) : null,
      syncedAt: integration.lastSuccessAt,
      error: integration.lastErrorCode
        ? { code: integration.lastErrorCode, message: integration.lastErrorMessage }
        : null,
      externalUrl: normalizeChallongePublicUrl(snapshot?.tournament?.fullChallongeUrl) || matchingLegacyUrl,
    };
  }
  if (tournament.bracket?.status === "published") {
    return {
      source: "native",
      status: "fresh",
      data: tournament.bracket.bracketData,
      syncedAt: tournament.bracket.lastUpdatedAt,
      error: null,
      externalUrl: normalizeChallongePublicUrl(tournament.bracketLink),
    };
  }
  return { source: "none", status: "unavailable", data: null, syncedAt: null, error: null, externalUrl: normalizeChallongePublicUrl(tournament.bracketLink) };
};

const claimDueIntegrationsForQueue = async () => {
  if (!env.CHALLONGE_ENABLED || !env.CHALLONGE_AUTOMATIC_SYNC_ENABLED) return [];
  const now = new Date();
  const rows = await prisma.challongeIntegration.findMany({
    where: {
      enabled: true,
      automaticSyncEnabled: true,
      syncFrequency: { in: ["one_minute", "five_minutes"] },
      nextSyncAt: { lte: now },
      OR: [{ syncLeaseUntil: null }, { syncLeaseUntil: { lt: now } }],
      tournament: { status: { not: "completed" } },
    },
    orderBy: { nextSyncAt: "asc" },
    take: 20,
    select: { id: true, nextSyncAt: true },
  });
  const claimed = [];
  for (const row of rows) {
    const reservation = new Date(now.getTime() + env.CHALLONGE_SYNC_LEASE_SECONDS * 1000);
    const result = await prisma.challongeIntegration.updateMany({
      where: { id: row.id, nextSyncAt: row.nextSyncAt },
      data: { nextSyncAt: reservation },
    });
    if (result.count) claimed.push(row.id);
  }
  return claimed;
};

module.exports = {
  ChallongeRequestError,
  extractChallongeIdentifier,
  normalizeSnapshot,
  mapChallongeStatus,
  requestChallongeJson,
  fetchChallongeSnapshot,
  syncChallongeIntegration,
  getAdminIntegration,
  saveAdminIntegration,
  createChallongeParticipant,
  updateChallongeParticipant,
  deleteChallongeParticipant,
  changeChallongeTournamentState,
  updateChallongeMatchResult,
  listSyncLogs,
  updateParticipantMapping,
  getPublicBracket,
  claimDueIntegrationsForQueue,
  recordChallongeSkippedAttempt,
};
