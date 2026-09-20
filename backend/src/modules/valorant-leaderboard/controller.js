const { asyncHandler } = require("../../lib/async-handler");
const { HttpError } = require("../../lib/http-error");
const { recordAuditAfterCommit, requestAuditContext } = require("../../lib/audit");
const {
  listAdminRegistrations,
  removeAdminRegistration,
  hideAdminRegistration,
  unhideAdminRegistration,
  listAdminRemovals,
  restoreAdminRemoval,
  listAdminBans,
  banAdminRegistration,
  banAdminRemoval,
  liftAdminBan,
  listAdminServerChecks,
  clearAdminServerCheck,
  reopenAdminServerCheck,
  listLeaderboard,
  searchLeaderboardPlayers,
  checkPuuid: serviceCheckPuuid,
  previewRegistration: servicePreviewRegistration,
} = require("./service");
const { registerValorantAccount } = require("../game-accounts/game-account.service");

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const respond = (res, data) =>
  res.status(200).json({ success: true, data, meta: { serverNow: new Date().toISOString() } });

// The public board shows Riot ID and Discord handle; the PUUID is an internal
// key the page never renders, so it stays off the anonymous responses.
const toPublicEntry = ({ puuid: _puuid, ...entry }) => entry;

// Matches the page size the site renders. A larger cap only made it easier to
// pull the whole board in one or two requests.
const PUBLIC_PER_PAGE_MAX = 50;

const getLeaderboard = asyncHandler(async (req, res) => {
  const page = Math.max(1, parsePositiveInt(req.query.page, 1));
  const perPage = clamp(parsePositiveInt(req.query.per_page, 50), 1, PUBLIC_PER_PAGE_MAX);
  const data = await listLeaderboard({ page, perPage });
  respond(res, { ...data, entries: data.entries.map(toPublicEntry) });
});

const SEARCH_LIMIT_MAX = 50;
const SEARCH_LIMIT_DEFAULT = 25;

const searchLeaderboard = asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim();
  const limit = clamp(parsePositiveInt(req.query.limit, SEARCH_LIMIT_DEFAULT), 1, SEARCH_LIMIT_MAX);
  const entries = query ? (await searchLeaderboardPlayers(query, { limit })).map(toPublicEntry) : [];
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

// Registering is how a player connects VALORANT, so the same request connects
// the account on Quest as well as putting it on the leaderboard.
const submitRegistration = asyncHandler(async (req, res) => {
  const data = await registerValorantAccount({
    userId: req.user.id,
    puuid: String(req.body?.puuid || ""),
    displayName: req.user.username || req.user.firstName || "Player",
    audit: requestAuditContext(req),
  });
  respond(res, data);
});

const ADMIN_QUERY_MAX_LENGTH = 100;
const REMOVAL_REASON_MAX_LENGTH = 500;

const listRegistrations = asyncHandler(async (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, ADMIN_QUERY_MAX_LENGTH);
  const hidden = req.query.hidden === "true";
  const page = Math.max(1, parsePositiveInt(req.query.page, 1));
  const perPage = clamp(parsePositiveInt(req.query.per_page, 50), 1, 200);
  const data = await listAdminRegistrations({ query, hidden, page, perPage, actorUserId: req.user.id });
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
  await recordAuditAfterCommit({
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
  await recordAuditAfterCommit({
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

// Hiding keeps a player registered and connected but off the public board. The
// reason is shown to the player on their profile, so it is required here the way
// a ban's is. The audit policy keeps PUUIDs out, so the Riot ID and Discord
// handle identify the player.
const hideAuditData = (player) => ({
  riotId: `${player.name}#${player.tag}`,
  discordUsername: player.discordUsername,
  currentTier: player.currentTier,
  elo: player.elo,
});

const hideRegistration = asyncHandler(async (req, res) => {
  const reason = readReason(req, "Give a reason for hiding this player. They will see it on their profile.");
  const data = await hideAdminRegistration({ puuid: req.params.puuid, reason, actorUserId: req.user.id });
  await recordAuditAfterCommit({
    ...requestAuditContext(req),
    action: "valorant.leaderboard_player.hide",
    targetType: "valorant_leaderboard_player",
    targetId: null,
    beforeData: { hidden: false },
    afterData: {
      ...hideAuditData(data.player),
      hidden: true,
      hiddenAt: data.player.hiddenAt,
      rankingsCleared: data.rankingsCleared,
    },
    source: "admin",
    reason,
  });
  respond(res, data);
});

const unhideRegistration = asyncHandler(async (req, res) => {
  const reason = readReason(req, "Give a reason for showing this player on the leaderboard again.");
  const data = await unhideAdminRegistration({ puuid: req.params.puuid, actorUserId: req.user.id });
  await recordAuditAfterCommit({
    ...requestAuditContext(req),
    action: "valorant.leaderboard_player.unhide",
    targetType: "valorant_leaderboard_player",
    targetId: null,
    beforeData: { hidden: true },
    afterData: { ...hideAuditData(data.player), hidden: false, onLeaderboard: data.player.onLeaderboard },
    source: "admin",
    reason,
  });
  respond(res, data);
});

const BAN_STATUSES = new Set(["active", "lifted", "all"]);

const listBans = asyncHandler(async (req, res) => {
  const status = BAN_STATUSES.has(req.query.status) ? req.query.status : "active";
  const query = String(req.query.q || "").trim().slice(0, ADMIN_QUERY_MAX_LENGTH);
  const page = Math.max(1, parsePositiveInt(req.query.page, 1));
  const perPage = clamp(parsePositiveInt(req.query.per_page, 20), 1, 100);
  const data = await listAdminBans({ status, query, page, perPage, actorUserId: req.user.id });
  respond(res, data);
});

// One audit row per ban, whichever list it was made from. The audit policy keeps
// PUUIDs out, so the Riot ID and Discord handle identify the banned player and
// every registration the ban removed.
const auditBan = async (req, data, reason) => {
  const { ban, removed } = data;
  await recordAuditAfterCommit({
    ...requestAuditContext(req),
    action: "valorant.leaderboard_player.ban",
    targetType: "valorant_leaderboard_player",
    targetId: null,
    beforeData: {
      registered: removed.map((entry) => ({
        riotId: `${entry.name}#${entry.tag}`,
        discordUsername: entry.discordUsername,
        currentTier: entry.currentTier,
        elo: entry.elo,
        removalId: entry.removalId,
      })),
    },
    afterData: {
      banId: ban.banId,
      riotId: `${ban.name}#${ban.tag}`,
      discordUsername: ban.discordUsername,
      riotAccountBanned: ban.puuid !== null,
      discordBanned: ban.discordBanned,
      rankingsCleared: data.rankingsCleared,
    },
    source: "admin",
    reason,
  });
};

const banRegistration = asyncHandler(async (req, res) => {
  const reason = readReason(req, "Give a reason for banning this player from the leaderboard.");
  const data = await banAdminRegistration({ puuid: req.params.puuid, reason, actorUserId: req.user.id });
  await auditBan(req, data, reason);
  respond(res, data);
});

const banRemoval = asyncHandler(async (req, res) => {
  const reason = readReason(req, "Give a reason for banning this player from the leaderboard.");
  const data = await banAdminRemoval({ removalId: req.params.removalId, reason, actorUserId: req.user.id });
  await auditBan(req, data, reason);
  respond(res, data);
});

const liftBan = asyncHandler(async (req, res) => {
  const reason = readReason(req, "Give a reason for lifting this ban.");
  const ban = await liftAdminBan({ banId: req.params.banId, actorUserId: req.user.id });
  await recordAuditAfterCommit({
    ...requestAuditContext(req),
    action: "valorant.leaderboard_player.unban",
    targetType: "valorant_leaderboard_player",
    targetId: null,
    beforeData: { banned: true, banId: ban.banId, bannedAt: ban.bannedAt },
    afterData: { riotId: `${ban.name}#${ban.tag}`, discordUsername: ban.discordUsername, liftedAt: ban.liftedAt },
    source: "admin",
    reason,
  });
  respond(res, ban);
});

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
  await recordAuditAfterCommit({
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
  await recordAuditAfterCommit({
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
  listBans,
  banRegistration,
  banRemoval,
  liftBan,
  listServerChecks,
  clearServerCheck,
  reopenServerCheck,
  listRegistrations,
  removeRegistration,
  hideRegistration,
  unhideRegistration,
  listRemovals,
  restoreRemoval,
  getLeaderboard,
  searchLeaderboard,
  checkPuuid,
  previewRegistration,
  submitRegistration,
};
