const crypto = require("crypto");
const { env } = require("../../config/env");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const cache = require("../../lib/cache");
const { normalizeText } = require("../../lib/validation");
const { publishRealtimeEvent } = require("../realtime/realtime.service");

const CHALLONGE_API_ORIGIN = "https://api.challonge.com";
const CHALLONGE_API_PREFIX = "/v1";
const SYNC_FREQUENCIES = new Set(["manual", "one_minute", "five_minutes"]);
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

const unwrap = (value, key) => value?.[key] || value;

const parseRetryAfter = (value) => {
  const seconds = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(seconds) && seconds > 0 ? Math.min(seconds, 3600) : null;
};

const requestChallongeJson = async (path) => {
  if (!env.CHALLONGE_ENABLED || !env.CHALLONGE_USERNAME || !env.CHALLONGE_API_KEY) {
    throw new ChallongeRequestError("Challonge synchronization is not configured.", {
      code: "challonge_disabled",
      status: 503,
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.CHALLONGE_REQUEST_TIMEOUT_MS);
  const authorization = Buffer.from(`${env.CHALLONGE_USERNAME}:${env.CHALLONGE_API_KEY}`, "utf8").toString("base64");
  try {
    const response = await fetch(`${CHALLONGE_API_ORIGIN}${CHALLONGE_API_PREFIX}${path}`, {
      headers: { Accept: "application/json", Authorization: `Basic ${authorization}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
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
    return await response.json();
  } catch (error) {
    if (error instanceof ChallongeRequestError) throw error;
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

const normalizeSnapshot = ({ tournamentPayload, participantPayload, matchPayload }) => {
  const tournament = unwrap(tournamentPayload, "tournament") || {};
  const participants = (Array.isArray(participantPayload) ? participantPayload : [])
    .map((entry) => unwrap(entry, "participant"))
    .filter(Boolean)
    .map((participant) => ({
      id: String(participant.id),
      name: String(participant.name || participant.display_name || "Participant").slice(0, 160),
      seed: Number.isInteger(participant.seed) ? participant.seed : null,
      active: participant.active !== false,
      finalRank: participant.final_rank ?? null,
      checkedInAt: participant.checked_in_at || null,
    }));
  const matches = (Array.isArray(matchPayload) ? matchPayload : [])
    .map((entry) => unwrap(entry, "match"))
    .filter(Boolean)
    .map((match) => ({
      id: String(match.id),
      identifier: match.identifier ? String(match.identifier) : null,
      round: Number.isInteger(match.round) ? match.round : null,
      state: String(match.state || "pending").toLowerCase(),
      player1Id: match.player1_id === null || match.player1_id === undefined ? null : String(match.player1_id),
      player2Id: match.player2_id === null || match.player2_id === undefined ? null : String(match.player2_id),
      winnerId: match.winner_id === null || match.winner_id === undefined ? null : String(match.winner_id),
      loserId: match.loser_id === null || match.loser_id === undefined ? null : String(match.loser_id),
      scoresCsv: match.scores_csv ? String(match.scores_csv).slice(0, 500) : null,
      scheduledAt: match.scheduled_time || null,
      startedAt: match.started_at || match.underway_at || null,
      underwayAt: match.underway_at || null,
      location: match.location ? String(match.location).slice(0, 120) : null,
      updatedAt: match.updated_at || null,
    }))
    .sort((left, right) => (left.round ?? 0) - (right.round ?? 0) || left.id.localeCompare(right.id));
  return {
    tournament: {
      id: tournament.id === undefined ? null : String(tournament.id),
      name: String(tournament.name || "Challonge Tournament").slice(0, 200),
      state: String(tournament.state || "pending").toLowerCase(),
      tournamentType: String(tournament.tournament_type || "unknown"),
      startedAt: tournament.started_at || null,
      completedAt: tournament.completed_at || null,
      updatedAt: tournament.updated_at || null,
      progressMeter: tournament.progress_meter ?? null,
    },
    participants,
    matches,
  };
};

const fetchChallongeSnapshot = async (identifier) => {
  const safeIdentifier = encodeURIComponent(identifier);
  const [tournamentPayload, participantPayload, matchPayload] = await Promise.all([
    requestChallongeJson(`/tournaments/${safeIdentifier}.json`),
    requestChallongeJson(`/tournaments/${safeIdentifier}/participants.json`),
    requestChallongeJson(`/tournaments/${safeIdentifier}/matches.json`),
  ]);
  return normalizeSnapshot({ tournamentPayload, participantPayload, matchPayload });
};

const mapChallongeStatus = (match) => {
  if (match.state === "complete") return "completed";
  if (match.state === "open" && match.underwayAt) return "live";
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

const syncChallongeIntegration = async ({ integrationId, trigger = "manual", requestId = null }) => {
  const integration = await prisma.challongeIntegration.findUnique({
    where: { id: integrationId },
    include: { tournament: { select: { id: true, slug: true, status: true } } },
  });
  if (!integration) throw new HttpError(404, "Challonge integration not found.");
  if (trigger === "scheduled" && !integration.enabled) return { skipped: true, reason: "disabled" };
  if (integration.tournament.status === "completed") {
    await prisma.challongeIntegration.update({ where: { id: integration.id }, data: { nextSyncAt: null, syncLeaseUntil: null } });
    return { skipped: true, reason: "completed" };
  }
  if (!(await claimSyncLease(integration.id))) return { skipped: true, reason: "already_running" };

  const log = await prisma.challongeSyncLog.create({
    data: { id: crypto.randomUUID(), integrationId: integration.id, status: "running", trigger, requestId },
  });
  try {
    const snapshot = await fetchChallongeSnapshot(integration.identifier);
    await syncSnapshotToMatches({ integration, snapshot });
    const serialized = JSON.stringify(snapshot);
    const snapshotHash = crypto.createHash("sha256").update(serialized).digest("hex");
    const completed = ["complete", "ended"].includes(snapshot.tournament.state);
    const now = new Date();
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
          nextSyncAt: completed ? null : getNextSyncAt(integration.syncFrequency, now),
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
    await prisma.$transaction([
      prisma.challongeIntegration.update({
        where: { id: integration.id },
        data: {
          lastErrorCode: code,
          lastErrorMessage: message,
          syncLeaseUntil: null,
          nextSyncAt: integration.enabled ? new Date(now.getTime() + retrySeconds * 1000) : null,
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
        retryAt: integration.enabled ? new Date(now.getTime() + retrySeconds * 1000) : null,
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
  syncFrequency: integration.syncFrequency,
  snapshotUpdatedAt: integration.snapshotUpdatedAt,
  nextSyncAt: integration.nextSyncAt,
  lastAttemptAt: integration.lastAttemptAt,
  lastSuccessAt: integration.lastSuccessAt,
  lastError: integration.lastErrorCode
    ? { code: integration.lastErrorCode, message: integration.lastErrorMessage }
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

const saveAdminIntegration = async ({ tournamentId, body }) => {
  const identifier = extractChallongeIdentifier(body.identifier || body.url);
  const syncFrequency = normalizeText(body.syncFrequency).toLowerCase() || "five_minutes";
  if (!identifier) throw new HttpError(400, "Enter a valid Challonge identifier or HTTPS tournament URL.");
  if (!SYNC_FREQUENCIES.has(syncFrequency)) throw new HttpError(400, "Invalid Challonge synchronization frequency.");
  const enabled = body.enabled === true || String(body.enabled).toLowerCase() === "true";
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true } });
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const integration = await prisma.challongeIntegration.upsert({
    where: { tournamentId },
    create: {
      id: crypto.randomUUID(),
      tournamentId,
      identifier,
      enabled,
      syncFrequency,
      nextSyncAt: enabled ? new Date() : null,
    },
    update: {
      identifier,
      enabled,
      syncFrequency,
      nextSyncAt: enabled ? new Date() : null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
    include: { participantLinks: true },
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

const getPublicBracket = async (slug) => {
  const tournament = await prisma.tournament.findFirst({
    where: { slug: normalizeText(slug).toLowerCase(), isPublished: true },
    include: { challongeIntegration: true, bracket: true },
  });
  if (!tournament) throw new HttpError(404, "Tournament not found.");
  const integration = tournament.challongeIntegration;
  if (integration?.enabled) {
    const ageMs = integration.lastSuccessAt ? Date.now() - integration.lastSuccessAt.getTime() : Infinity;
    const staleAfterMs = (integration.syncFrequency === "one_minute" ? 3 : 10) * 60_000;
    return {
      source: "challonge",
      status: integration.snapshotData ? (ageMs > staleAfterMs ? "stale" : "fresh") : "unavailable",
      data: integration.snapshotData || null,
      syncedAt: integration.lastSuccessAt,
      error: integration.lastErrorCode
        ? { code: integration.lastErrorCode, message: integration.lastErrorMessage }
        : null,
      externalUrl: tournament.bracketLink,
    };
  }
  if (tournament.bracket?.status === "published") {
    return {
      source: "native",
      status: "fresh",
      data: tournament.bracket.bracketData,
      syncedAt: tournament.bracket.lastUpdatedAt,
      error: null,
      externalUrl: tournament.bracketLink,
    };
  }
  return { source: "none", status: "unavailable", data: null, syncedAt: null, error: null, externalUrl: tournament.bracketLink };
};

const claimDueIntegrationsForQueue = async () => {
  if (!env.CHALLONGE_ENABLED) return [];
  const now = new Date();
  const rows = await prisma.challongeIntegration.findMany({
    where: {
      enabled: true,
      syncFrequency: { not: "manual" },
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
  listSyncLogs,
  updateParticipantMapping,
  getPublicBracket,
  claimDueIntegrationsForQueue,
};
