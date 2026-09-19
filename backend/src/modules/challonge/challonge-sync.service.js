const crypto = require("crypto");
const { env } = require("../../config/env");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const { logger } = require("../../lib/logger");
const cache = require("../../lib/cache");
const { publishRealtimeEvent } = require("../realtime/realtime.service");
const { sanitizeErrorMessage, fetchChallongeSnapshot } = require("./challonge-api");

const SYNC_FREQUENCIES = new Set(["manual", "one_minute", "five_minutes"]);
const buildSyncedTournamentUpdate = (snapshot) => ({
  ...(snapshot?.tournament?.fullChallongeUrl
    ? { bracketLink: snapshot.tournament.fullChallongeUrl }
    : {}),
  ...(["complete", "completed", "ended"].includes(snapshot?.tournament?.state)
    ? { status: "completed", isActive: false }
    : {}),
});
const LOCAL_OPERATIONAL_STATUSES = new Set([
  "check_in_open",
  "veto_starting_soon",
  "veto_in_progress",
  "ready",
  "delayed",
  "paused",
]);

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
    const tournamentUpdate = buildSyncedTournamentUpdate(snapshot);
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
      ...(Object.keys(tournamentUpdate).length
        ? [prisma.tournament.update({
            where: { id: integration.tournamentId },
            data: tournamentUpdate,
          })]
        : []),
    ]);
    publishRealtimeEvent("brackets", { tournamentId: integration.tournamentId, syncedAt: now.toISOString() });
    publishRealtimeEvent("matches", { tournamentId: integration.tournamentId, syncedAt: now.toISOString() });
    await cache.invalidateTags(["foundation", "tournaments"]);
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
  SYNC_FREQUENCIES,
  buildSyncedTournamentUpdate,
  mapChallongeStatus,
  parseScores,
  recordChallongeSkippedAttempt,
  syncChallongeIntegration,
  claimDueIntegrationsForQueue,
};
