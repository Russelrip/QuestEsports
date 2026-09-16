const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const {
  listAdminRegistrations,
  removeAdminRegistration,
  listAdminRemovals,
  restoreAdminRemoval,
  listAdminServerChecks,
  clearAdminServerCheck,
  reopenAdminServerCheck,
  listLeaderboard,
  searchLeaderboardPlayers,
  checkPuuid: serviceCheckPuuid,
  previewRegistration: servicePreviewRegistration,
  submitRegistration: serviceSubmitRegistration,
} = require("./service");

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const respond = (res, data) =>
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });

const getLeaderboard = asyncHandler(async (req, res) => {
  const page = Math.max(1, parsePositiveInt(req.query.page, 1));
  const perPage = clamp(parsePositiveInt(req.query.per_page, 50), 1, 200);
  const data = await listLeaderboard({ page, perPage });
  respond(res, data);
});

const SEARCH_LIMIT_MAX = 50;
const SEARCH_LIMIT_DEFAULT = 25;

const searchLeaderboard = asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim();
  const limit = clamp(parsePositiveInt(req.query.limit, SEARCH_LIMIT_DEFAULT), 1, SEARCH_LIMIT_MAX);
  const entries = query ? await searchLeaderboardPlayers(query, { limit }) : [];
  // `entry` is the legacy single-result field, kept so older clients keep working.
  respond(res, { entries, entry: entries[0] ?? null });
});

const checkPuuid = asyncHandler(async (req, res) => {
  const data = await serviceCheckPuuid({
    userId: req.user.id,
    puuid: String(req.body?.puuid || ""),
  });
  respond(res, data);
});

const previewRegistration = asyncHandler(async (req, res) => {
  const data = await servicePreviewRegistration({
    userId: req.user.id,
    puuid: String(req.body?.puuid || ""),
  });
  respond(res, data);
});

const submitRegistration = asyncHandler(async (req, res) => {
  const data = await serviceSubmitRegistration({
    userId: req.user.id,
    puuid: String(req.body?.puuid || ""),
  });
  respond(res, data);
});

const ADMIN_QUERY_MAX_LENGTH = 100;
const REMOVAL_REASON_MAX_LENGTH = 500;

const listRegistrations = asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, ADMIN_QUERY_MAX_LENGTH);
  const page = Math.max(1, parsePositiveInt(req.query.page, 1));
  const perPage = clamp(parsePositiveInt(req.query.per_page, 50), 1, 200);
  const data = await listAdminRegistrations({ query, page, perPage, actorUserId: req.user.id });
  respond(res, data);
});

const removeRegistration = asyncHandler(async (req, res) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    throw new HttpError(400, "Give a reason for removing this player from the leaderboard.");
  }
  if (reason.length > REMOVAL_REASON_MAX_LENGTH) {
    throw new HttpError(400, `Keep the reason under ${REMOVAL_REASON_MAX_LENGTH} characters.`);
  }

  const data = await removeAdminRegistration({ puuid: req.params.puuid, actorUserId: req.user.id });
  const { removed } = data;
  // The audit policy keeps PUUIDs out of audit rows, so the Riot ID and Discord
  // handle are what identify the removed registration.
  await recordAudit({
    ...requestAuditContext(req),
    action: "valorant.leaderboard_player.remove",
    targetType: "valorant_leaderboard_player",
    targetId: null,
    beforeData: {
      riotId: `${removed.name}#${removed.tag}`,
      discordUsername: removed.discordUsername,
      currentTier: removed.currentTier,
      elo: removed.elo,
      lastPlayed: removed.lastPlayed,
      updateSource: removed.updateSource,
      updatedAt: removed.updatedAt,
      onLeaderboard: removed.onLeaderboard,
    },
    afterData: { removed: true, removalId: data.removalId, rankingsCleared: data.rankingsCleared },
    source: "admin",
    reason,
  });
  respond(res, data);
});

const listRemovals = asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, ADMIN_QUERY_MAX_LENGTH);
  const page = Math.max(1, parsePositiveInt(req.query.page, 1));
  const perPage = clamp(parsePositiveInt(req.query.per_page, 20), 1, 100);
  const data = await listAdminRemovals({ query, page, perPage, actorUserId: req.user.id });
  respond(res, data);
});

const restoreRemoval = asyncHandler(async (req, res) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    throw new HttpError(400, "Give a reason for restoring this player to the leaderboard.");
  }
  if (reason.length > REMOVAL_REASON_MAX_LENGTH) {
    throw new HttpError(400, `Keep the reason under ${REMOVAL_REASON_MAX_LENGTH} characters.`);
  }

  const data = await restoreAdminRemoval({ removalId: req.params.removalId, actorUserId: req.user.id });
  const { restored } = data;
  await recordAudit({
    ...requestAuditContext(req),
    action: "valorant.leaderboard_player.restore",
    targetType: "valorant_leaderboard_player",
    targetId: null,
    beforeData: { removed: true, removalId: data.removalId, removedAt: data.removedAt },
    afterData: {
      riotId: `${restored.name}#${restored.tag}`,
      discordUsername: restored.discordUsername,
      currentTier: restored.currentTier,
      elo: restored.elo,
      lastPlayed: restored.lastPlayed,
      onLeaderboard: restored.onLeaderboard,
    },
    source: "admin",
    reason,
  });
  respond(res, data);
});

const SERVER_CHECK_STATUSES = new Set(["flagged", "cleared", "all"]);
const SERVER_NAME_MAX_LENGTH = 50;
const SERVER_CHECK_SORTS = new Set(["default", "rank", "rank_low", "away", "matches", "recent", "name"]);

const readReason = (req, missingMessage) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    throw new HttpError(400, missingMessage);
  }
  if (reason.length > REMOVAL_REASON_MAX_LENGTH) {
    throw new HttpError(400, `Keep the reason under ${REMOVAL_REASON_MAX_LENGTH} characters.`);
  }
  return reason;
};

// What a server check decision was based on, for the audit row. The audit
// policy keeps PUUIDs out, so the Riot ID and Discord handle identify the player.
const serverCheckAuditData = (entry) => ({
  riotId: `${entry.name}#${entry.tag}`,
  discordUsername: entry.discordUsername,
  accountRegion: entry.accountRegion,
  status: entry.status,
  reasons: entry.reasons,
  awayMatches: entry.awayMatches,
  knownMatches: entry.knownMatches,
  servers: entry.servers.map((server) => `${server.cluster ?? "Unknown"} ${server.matches}`).join(", "),
  since: entry.since,
});

const listServerChecks = asyncHandler(async (req, res) => {
  const status = SERVER_CHECK_STATUSES.has(req.query.status) ? req.query.status : "flagged";
  const query = String(req.query.q || "").trim().slice(0, ADMIN_QUERY_MAX_LENGTH);
  const server = String(req.query.server || "").trim().slice(0, SERVER_NAME_MAX_LENGTH);
  const sort = SERVER_CHECK_SORTS.has(req.query.sort) ? req.query.sort : "default";
  const page = Math.max(1, parsePositiveInt(req.query.page, 1));
  const perPage = clamp(parsePositiveInt(req.query.per_page, 20), 1, 100);
  const data = await listAdminServerChecks({ status, query, server, sort, page, perPage, actorUserId: req.user.id });
  respond(res, data);
});

// Keeping a flagged player. The audit row records what the flag was when the
// admin decided, since the clearance itself resets what counts.
const clearServerCheck = asyncHandler(async (req, res) => {
  const reason = readReason(req, "Give a reason for keeping this player on the leaderboard.");
  const data = await clearAdminServerCheck({ puuid: req.params.puuid, actorUserId: req.user.id });
  await recordAudit({
    ...requestAuditContext(req),
    action: "valorant.leaderboard_player.server_check_clear",
    targetType: "valorant_leaderboard_player",
    targetId: null,
    beforeData: { flagged: true },
    afterData: { ...serverCheckAuditData(data), clearedAt: data.clearedAt },
    source: "admin",
    reason,
  });
  respond(res, data);
});

const reopenServerCheck = asyncHandler(async (req, res) => {
  const reason = readReason(req, "Give a reason for reopening this player's server check.");
  const data = await reopenAdminServerCheck({ puuid: req.params.puuid, actorUserId: req.user.id });
  await recordAudit({
    ...requestAuditContext(req),
    action: "valorant.leaderboard_player.server_check_reopen",
    targetType: "valorant_leaderboard_player",
    targetId: null,
    beforeData: { cleared: true },
    afterData: serverCheckAuditData(data),
    source: "admin",
    reason,
  });
  respond(res, data);
});

module.exports = {
  listServerChecks,
  clearServerCheck,
  reopenServerCheck,
  listRegistrations,
  removeRegistration,
  listRemovals,
  restoreRemoval,
  getLeaderboard,
  searchLeaderboard,
  checkPuuid,
  previewRegistration,
  submitRegistration,
};
