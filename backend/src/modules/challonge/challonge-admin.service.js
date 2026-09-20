const crypto = require("crypto");
const { env } = require("../../config/env");
const { prisma } = require("../../lib/prisma");
const { HttpError } = require("../../lib/http-error");
const cache = require("../../lib/cache");
const { normalizeText } = require("../../lib/validation");
const {
  ChallongeRequestError,
  extractChallongeIdentifier,
  normalizeChallongePublicUrl,
  requestChallongeJson,
  normalizeSnapshot,
  resolveApplicationTournamentId,
} = require("./challonge-api");
const { SYNC_FREQUENCIES } = require("./challonge-sync.service");

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
  if (transition === "finalize") {
    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: "completed", isActive: false },
    });
  }
  await cache.invalidateTags(["foundation", "tournaments"]);
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

module.exports = {
  getAdminIntegration,
  createChallongeParticipant,
  updateChallongeParticipant,
  deleteChallongeParticipant,
  changeChallongeTournamentState,
  updateChallongeMatchResult,
  saveAdminIntegration,
  listSyncLogs,
  updateParticipantMapping,
};
